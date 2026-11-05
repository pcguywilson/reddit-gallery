// Runs BEFORE gallery.user.js. Applies app settings without modifying the userscript.
// window.__RG_CFG is set by MainActivity: { autoplay, muteDefault, nsfw, swipe, tapNav }
(function () {
    if (window.__rgBoot) return;
    window.__rgBoot = true;
    const cfg = window.__RG_CFG || {};
    const P = HTMLMediaElement.prototype;

    // The app is already immersive; element fullscreen in WebView would hide the native menu button.
    Element.prototype.requestFullscreen = function () {
        return Promise.reject(new Error('fullscreen handled by app'));
    };

    // Sandbox every iframe (redgifs player etc.) before it loads: scripts and fullscreen
    // still work, but it can't navigate the app or open popups.
    const SANDBOX = 'allow-scripts allow-same-origin allow-presentation';
    const ifrSrc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        configurable: true,
        get() { return ifrSrc.get.call(this); },
        set(v) { this.setAttribute('sandbox', SANDBOX); ifrSrc.set.call(this, v); }
    });
    window.open = function () { return null; };

    // Mute by default: script-driven unmutes are ignored; user unmutes via native video controls.
    if (cfg.muteDefault) {
        const mutedD = Object.getOwnPropertyDescriptor(P, 'muted');
        Object.defineProperty(P, 'muted', {
            configurable: true,
            get() { return mutedD.get.call(this); },
            set(v) { mutedD.set.call(this, true); }
        });
    }

    // Autoplay off: block script-driven play() and the autoplay attribute; native play button still works.
    if (!cfg.autoplay) {
        P.play = function () {
            return Promise.reject(new DOMException('autoplay disabled', 'NotAllowedError'));
        };
        const apD = Object.getOwnPropertyDescriptor(P, 'autoplay');
        Object.defineProperty(P, 'autoplay', {
            configurable: true,
            get() { return apD.get.call(this); },
            set(v) { apD.set.call(this, false); }
        });
        new MutationObserver(muts => {
            for (const m of muts) for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                const vids = n.tagName === 'VIDEO' ? [n] : n.querySelectorAll('video');
                vids.forEach(v => { v.removeAttribute('autoplay'); v.autoplay = false; });
            }
        }).observe(document.documentElement, { childList: true, subtree: true });
    }

    // Full-size media for posts that would otherwise fall back to the 140px thumbnail:
    // galleries (first image from media_metadata) and crossposts (parent's media/preview).
    function fixMedia(p) {
        if (!p) return;
        const parent = Array.isArray(p.crosspost_parent_list) && p.crosspost_parent_list[0];
        if (parent) {
            if (!p.preview && parent.preview) p.preview = parent.preview;
            if (!p.media_metadata && parent.media_metadata) p.media_metadata = parent.media_metadata;
            if (!p.gallery_data && parent.gallery_data) p.gallery_data = parent.gallery_data;
            if (parent.is_video && parent.media && parent.media.reddit_video) {
                p.is_video = true;
                p.media = parent.media;
            }
        }
        if (!(p.preview && p.preview.images && p.preview.images[0]) && p.media_metadata) {
            const order = (p.gallery_data && p.gallery_data.items || []).map(i => i.media_id);
            const ids = order.length ? order : Object.keys(p.media_metadata);
            for (const id of ids) {
                const m = p.media_metadata[id];
                const src = m && m.s && (m.s.u || m.s.gif);
                if (src) {
                    p.preview = { images: [{ source: { url: src, width: m.s.x, height: m.s.y } }] };
                    break;
                }
            }
        }
    }

    // Post age ("3h ago"). Shown in the grid meta line (appended to author, which the
    // script prints as "u/NAME") and in the fullscreen title (autostart.js looks it up).
    window.__rgAge = window.__rgAge || {};
    function ago(utc) {
        if (!utc) return '';
        const s = Math.max(0, Date.now() / 1000 - utc);
        if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
        return new Date(utc * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function addAge(p) {
        if (!p || p.__rgAged) return;
        const a = ago(p.created_utc);
        if (!a) return;
        p.__rgAged = true;
        p.author = (p.author || '') + ' · ' + a;
        if (p.title) window.__rgAge[p.title] = a;
    }

    // Rewrite every Reddit listing JSON the script fetches.
    const origFetch = window.fetch;
    // RedGifs API now needs a temporary bearer token; without it the script falls back to
    // the iframe player (which swallows swipes). Add the token so it gets the direct video.
    let rgToken = null;
    async function redgifsToken() {
        if (rgToken) return rgToken;
        const r = await origFetch.call(window, 'https://api.redgifs.com/v2/auth/temporary');
        rgToken = (await r.json()).token;
        return rgToken;
    }

    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/^https:\/\/api\.redgifs\.com\/v2\/gifs\//.test(url)) {
            try {
                const tok = await redgifsToken();
                let r = await origFetch.call(this, url, { headers: { Authorization: 'Bearer ' + tok } });
                if (r.status === 401) {
                    rgToken = null;
                    r = await origFetch.call(this, url, { headers: { Authorization: 'Bearer ' + (await redgifsToken()) } });
                }
                if (r.ok) return r;
            } catch (_) { }
            return origFetch.call(this, input, init);
        }
        const res = await origFetch.call(this, input, init);
        if (!/reddit\.com\/.*\.json/.test(url)) return res;
        try {
            const data = await res.clone().json();
            if (data && data.data && Array.isArray(data.data.children)) {
                let kids = data.data.children;
                // NSFW off: drop over_18 posts
                if (!cfg.nsfw) kids = kids.filter(c => !(c.data && c.data.over_18));
                kids.forEach(c => {
                    fixMedia(c.data);
                    // subreddit per post, keyed by title (same lookup as age)
                    if (c.data && c.data.title && c.data.subreddit)
                        (window.__rgSub = window.__rgSub || {})[c.data.title] = c.data.subreddit;
                    addAge(c.data);
                });
                data.data.children = kids;
                return new Response(JSON.stringify(data), {
                    status: res.status, statusText: res.statusText, headers: res.headers
                });
            }
        } catch (_) { }
        return res;
    };
})();
