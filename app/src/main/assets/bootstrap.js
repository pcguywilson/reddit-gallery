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

    // NSFW off: strip over_18 posts from every Reddit listing JSON the script fetches.
    if (!cfg.nsfw) {
        const origFetch = window.fetch;
        window.fetch = async function (input, init) {
            const res = await origFetch.call(this, input, init);
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (!/reddit\.com\/.*\.json/.test(url)) return res;
            try {
                const data = await res.clone().json();
                if (data && data.data && Array.isArray(data.data.children)) {
                    data.data.children = data.data.children.filter(c => !(c.data && c.data.over_18));
                    return new Response(JSON.stringify(data), {
                        status: res.status, statusText: res.statusText, headers: res.headers
                    });
                }
            } catch (_) { }
            return res;
        };
    }
})();
