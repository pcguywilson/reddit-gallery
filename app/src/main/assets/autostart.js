// Runs AFTER gallery.user.js. Starts gallery mode, applies mobile CSS, adds app hooks.
(function () {
    if (window.__rgStarted) return;
    window.__rgStarted = true;
    const cfg = window.__RG_CFG || {};

    const css = document.createElement('style');
    css.textContent = `
        #gallery-launcher, #btn-toggle-gallery, #btn-all, #btn-images, #btn-videos, #btn-options { display: none !important; }
        #gallery-container { padding: 10px !important; }
        /* Only Sort is left in the top bar (media filter lives in app Settings) */
        #gallery-controls { position: static !important; transform: none !important; display: flex !important;
            justify-content: space-between !important; align-items: center !important; margin: 0 0 8px 0 !important; padding: 0 !important;
            background: transparent !important; box-shadow: none !important; }
        .gallery-select-wrap { padding: 0 10px !important; font-size: 13px !important; }
        .gallery-select-wrap select { min-height: 34px !important; font-size: 13px !important; }
        #gallery-controls button { padding: 8px 10px !important; font-size: 13px !important; }
        #gallery-grid { margin-top: 0 !important; }
        #gallery-options-panel { margin: 0 auto 10px !important; }
        #fullscreen-close { top: 12px !important; right: 12px !important;
            font-size: 28px !important; padding: 6px 14px !important; }
        /* Title bottom-left, clear of the app's bottom-right button */
        #fullscreen-title { opacity: 0.9 !important; pointer-events: auto !important;
            top: auto !important; bottom: 28px !important; left: 12px !important; transform: none !important;
            max-width: calc(100vw - 110px) !important; text-align: left !important; font-size: 14px !important; }
        #gallery-container { padding-bottom: 96px !important; }
        #fullscreen-content { width: 100vw !important; max-width: 100vw !important;
            height: 86vh !important; max-height: 86vh !important; }
        #rg-feed-name { color: #FF5700; font: 700 20px/1.2 sans-serif; padding: 0 4px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
        /* Swipe layer over embedded players; bottom strip left open for their controls */
        #fullscreen-content .rg-swipe { position: absolute; left: 0; right: 0; top: 0; bottom: 22%;
            z-index: 5; background: transparent; }
        /* Always fill the viewer: small images/videos scale up, large ones scale down */
        #fullscreen-content img, #fullscreen-content video {
            width: 100% !important; height: 100% !important;
            max-width: 100% !important; max-height: 100% !important; object-fit: contain !important; }
    `;
    document.head.appendChild(css);

    // Feed name, top-left of the bar (Sort stays on the right)
    const controls = document.getElementById('gallery-controls');
    if (controls) {
        const seg = location.pathname.split('/').filter(Boolean);
        let name = 'frontpage';
        if (seg[0] === 'r' && seg[1]) name = seg[1].toLowerCase() === 'all' || seg[1].toLowerCase() === 'popular' ? seg[1] : 'r/' + seg[1];
        else if (seg[0] === 'all' || seg[0] === 'popular') name = seg[0];
        else if ((seg[0] === 'user' || seg[0] === 'u' || seg[0] === 'me') && seg.indexOf('m') > 0) name = 'm/' + seg[seg.indexOf('m') + 1];
        else if ((seg[0] === 'user' || seg[0] === 'u') && seg[1]) name = 'u/' + seg[1];
        const label = document.createElement('div');
        label.id = 'rg-feed-name';
        label.textContent = name;
        controls.insertBefore(label, controls.firstChild);
    }

    // Media filter from app Settings (click before the launcher so the first load is already filtered).
    if (cfg.media && cfg.media !== 'all') {
        const b = document.getElementById('btn-' + cfg.media);
        if (b) b.click();
    }

    // Auto-enter gallery mode (the script starts with galleryEnabled = false).
    const launcher = document.getElementById('gallery-launcher');
    if (launcher && !document.body.classList.contains('gallery-mode')) launcher.click();

    // Fullscreen title: append post age
    const fsTitle = document.getElementById('fullscreen-title');
    if (fsTitle) {
        new MutationObserver(() => {
            const t = fsTitle.textContent;
            const a = (window.__rgAge || {})[t];
            if (a) fsTitle.textContent = t + '  · ' + a;
        }).observe(fsTitle, { childList: true, characterData: true, subtree: true });
    }

    // When the script falls back to an iframe player, cover it so swipes reach the viewer.
    const fsContent = document.getElementById('fullscreen-content');
    if (fsContent) {
        new MutationObserver(() => {
            if (fsContent.querySelector('iframe') && !fsContent.querySelector('.rg-swipe')) {
                const layer = document.createElement('div');
                layer.className = 'rg-swipe';
                fsContent.appendChild(layer);
            }
        }).observe(fsContent, { childList: true });
    }

    // Comment links use target=_blank, which the app blocks as a popup. Open them in place
    // instead; the app hands any /comments/ URL to the Reddit app.
    document.addEventListener('click', e => {
        const a = e.target.closest && e.target.closest('a[href*="/comments/"]');
        if (!a) return;
        e.preventDefault();
        e.stopPropagation();
        location.href = a.href;
    }, true);

    const viewer = document.getElementById('fullscreen-viewer');
    const key = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

    // Called by the Android back button. Returns true if it closed the fullscreen viewer.
    window.__rgBack = function () {
        if (viewer && viewer.classList.contains('active')) { key('Escape'); return true; }
        return false;
    };

    if (viewer && cfg.swipe === 'both') {
        let sx = 0, sy = 0;
        viewer.addEventListener('touchstart', e => {
            sx = e.changedTouches[0].screenX; sy = e.changedTouches[0].screenY;
        }, { passive: true });
        viewer.addEventListener('touchend', e => {
            const dx = sx - e.changedTouches[0].screenX;
            const dy = sy - e.changedTouches[0].screenY;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) key(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
        }, { passive: true });
    }

    if (viewer && cfg.tapNav) {
        viewer.addEventListener('click', e => {
            if (e.target.closest('a, button, video, iframe')) return;
            const w = window.innerWidth;
            if (e.clientX > w * 0.75) key('ArrowDown');
            else if (e.clientX < w * 0.25) key('ArrowUp');
        });
    }
})();
