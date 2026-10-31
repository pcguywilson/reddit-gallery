// ==UserScript==
// @name         Reddit Gallery Scroller
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Browse subreddits as an infinite scrolling gallery. Vertical swipe navigation + consistent media size + true fullscreen.
// @match        https://www.reddit.com/r/*
// @match        https://old.reddit.com/r/*
// @match        https://www.reddit.com/all/*
// @match        https://old.reddit.com/all/*
// @match        https://www.reddit.com/all
// @match        https://old.reddit.com/all
// @match        https://www.reddit.com/popular/*
// @match        https://old.reddit.com/popular/*
// @match        https://www.reddit.com/popular
// @match        https://old.reddit.com/popular
// @match        https://www.reddit.com/user/*
// @match        https://old.reddit.com/user/*
// @match        https://www.reddit.com/u/*
// @match        https://old.reddit.com/u/*
// @match        https://www.reddit.com/
// @match        https://old.reddit.com/
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const ACTIVATION_LINE_RATIO = 0.4;
    const SETTINGS_KEY = 'reddit-gallery-scroller-settings';
    const DEFAULT_SETTINGS = {
        seekSeconds: 5,
        flairFilter: '',
    };

    let currentFilter = 'all';
    let currentSort = getInitialSort();
    let posts = [];
    let after = null;
    let loading = false;
    let galleryEnabled = false;
    const modhash = getModhash();
    const listingPath = getListingPath();
    const settings = loadSettings();

    let currentFullscreenIndex = -1;
    let currentVideo = null;
    let focusedGridVideo = null;
    let scrollTicking = false;
    let seenSourceKeys = new Set();
    let fullscreenWheelLocked = false;

    const originalRoot = document.createElement('div');
    originalRoot.id = 'reddit-original-root';
    while (document.body.firstChild) {
        originalRoot.appendChild(document.body.firstChild);
    }
    document.body.appendChild(originalRoot);

    const app = document.createElement('div');
    app.id = 'gallery-container';
    app.innerHTML = `
        <div id="gallery-controls">
            <button id="btn-toggle-gallery" class="gallery-primary">${galleryEnabled ? 'Gallery On' : 'Gallery Off'}</button>
            <button id="btn-all" class="active">All</button>
            <button id="btn-images">Images Only</button>
            <button id="btn-videos">Videos Only</button>
            <label class="gallery-select-wrap" for="gallery-sort">
                <span>Sort</span>
                <select id="gallery-sort">
                    <option value="hot">Hot</option>
                    <option value="new">New</option>
                    <option value="top">Top</option>
                    <option value="rising">Rising</option>
                    <option value="controversial">Controversial</option>
                    <option value="random">Random</option>
                    <option value="flair">Flair</option>
                </select>
            </label>
            <button id="btn-options" type="button">Options</button>
        </div>
        <div id="gallery-options-panel" hidden>
            <label class="gallery-option-row" for="gallery-seek-seconds">
                <span>Seek step (seconds)</span>
                <input id="gallery-seek-seconds" type="number" min="1" max="120" step="1">
            </label>
            <label class="gallery-option-row" for="gallery-flair-filter">
                <span>Flair filter</span>
                <input id="gallery-flair-filter" type="text" placeholder="Exact flair text">
            </label>
        </div>
        <div id="gallery-grid"></div>
        <div id="gallery-loader">Loading...</div>
    `;

    const launcher = document.createElement('button');
    launcher.id = 'gallery-launcher';
    launcher.type = 'button';
    launcher.textContent = galleryEnabled ? 'Gallery On' : 'Open Gallery';

    const fullscreenViewer = document.createElement('div');
    fullscreenViewer.id = 'fullscreen-viewer';
    fullscreenViewer.tabIndex = -1;
    fullscreenViewer.innerHTML = `
        <button id="fullscreen-close" aria-label="Close">x</button>
        <div id="fullscreen-content"></div>
        <a id="fullscreen-title" href="#" target="_blank" rel="noopener noreferrer"></a>
    `;

    const style = document.createElement('style');
    style.textContent = `
        html, body { margin: 0; padding: 0; background: #1a1a1b; }
        body.gallery-mode { background: #1a1a1b; }
        body.gallery-fullscreen-open { overflow: hidden; }
        #reddit-original-root { display: block; }
        body.gallery-mode #reddit-original-root { display: none !important; }
        #gallery-container { display: none; padding: 20px; max-width: 100%; transition: filter 0.2s ease, opacity 0.2s ease; }
        body.gallery-mode #gallery-container { display: block; }
        #gallery-launcher { position: fixed; top: 18px; right: 18px; z-index: 2147483000; border: none; border-radius: 999px; background: #0079d3; color: #fff; padding: 10px 16px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
        body.gallery-mode #gallery-launcher { background: #4a4c4d; }
        body.gallery-fullscreen-open #gallery-container { filter: blur(6px) brightness(0.2); opacity: 0.55; pointer-events: none; user-select: none; }
        #gallery-controls { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; background: #272729; padding: 10px; border-radius: 10px; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
        #gallery-controls button { background: #343536; border: none; color: #d7dadc; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-size: 14px; }
        #gallery-controls button.active, #gallery-controls button.gallery-primary { background: #0079d3; }
        .gallery-select-wrap { display: inline-flex; align-items: center; gap: 8px; background: #343536; color: #d7dadc; padding: 0 12px; border-radius: 6px; font-size: 14px; }
        .gallery-select-wrap select { background: transparent; color: #d7dadc; border: none; min-height: 40px; font-size: 14px; outline: none; }
        #gallery-options-panel { width: min(420px, calc(100% - 32px)); margin: 92px auto 18px; padding: 14px 16px; border-radius: 10px; background: #272729; box-shadow: 0 4px 12px rgba(0,0,0,0.4); color: #d7dadc; }
        .gallery-option-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .gallery-option-row input { width: 90px; min-height: 36px; border: none; border-radius: 6px; background: #343536; color: #d7dadc; padding: 0 10px; font-size: 14px; }
        #gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; margin-top: 92px; }
        .gallery-item { background: #272729; border-radius: 10px; overflow: hidden; cursor: pointer; position: relative; box-shadow: 0 4px 14px rgba(0,0,0,0.35); }
        .gallery-item.is-focused { box-shadow: 0 0 0 2px #0079d3, 0 12px 28px rgba(0,0,0,0.5); }
        .gallery-item img, .gallery-item video { width: 100%; height: 340px; object-fit: cover; display: block; background: #222; }
        .gallery-item-title { padding: 14px 14px 8px; color: #d7dadc; font-size: 18px; font-weight: 700; line-height: 1.35; }
        .gallery-item-meta { padding: 0 14px 12px; color: #8d9496; font-size: 12px; }
        .gallery-item-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 14px 14px; }
        .gallery-item-actions button, .gallery-item-actions a { display: inline-flex; align-items: center; justify-content: center; min-height: 34px; padding: 0 12px; border: none; border-radius: 6px; background: #343536; color: #d7dadc; text-decoration: none; font-size: 13px; cursor: pointer; }
        .gallery-item-actions button.is-active { background: #0079d3; }
        .gallery-item-type { position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 5px 10px; border-radius: 4px; font-size: 12px; }
        .gallery-item-audio { position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.72); color: #fff; padding: 5px 9px; border-radius: 4px; font-size: 12px; }
        #gallery-loader { text-align: center; padding: 40px; color: #818384; font-size: 18px; display: none; }
        #fullscreen-viewer { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.96); z-index: 2147483647; align-items: center; justify-content: center; user-select: none; touch-action: pan-x; }
        #fullscreen-viewer.active { display: flex; }
        #fullscreen-content { max-width: 90vw; max-height: 85vh; width: 90vw; height: 85vh; position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; }
        #fullscreen-content img, #fullscreen-content video {
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: auto;
            object-fit: contain;
            display: block;
            margin: 0 auto;
        }
        #fullscreen-content iframe { width: 90vw; height: 85vh; border: none; display: block; }
        #fullscreen-close { position: fixed; top: 20px; right: 20px; background: rgba(0,0,0,0.65); color: white; border: none; font-size: 36px; padding: 10px 20px; cursor: pointer; z-index: 2147483648; border-radius: 4px; }
        #fullscreen-title { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.7); color: white; padding: 12px 22px; border-radius: 8px; max-width: min(60vw, 900px); text-align: center; z-index: 2147483648; font-size: 16px; line-height: 1.4; text-decoration: none; opacity: 0; pointer-events: none; transition: opacity 0.18s ease; }
        #fullscreen-viewer:hover #fullscreen-title, #fullscreen-title:hover { opacity: 1; pointer-events: auto; }
        @media (max-width: 800px) {
            #gallery-grid { grid-template-columns: 1fr; }
            .gallery-item img, .gallery-item video { height: 300px; }
            #fullscreen-title { top: auto; bottom: 16px; max-width: calc(100vw - 32px); font-size: 14px; }
            #fullscreen-content { max-height: 80vh; height: 80vh; }
        }
    `;

    document.head.appendChild(style);
    document.body.appendChild(launcher);
    document.body.appendChild(app);
    document.body.appendChild(fullscreenViewer);

    // === VERTICAL SWIPE SUPPORT ===
    let touchStartX = 0;
    let touchStartY = 0;
    fullscreenViewer.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    fullscreenViewer.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].screenX;
        const touchEndY = e.changedTouches[0].screenY;
        const diffX = touchStartX - touchEndX;
        const diffY = touchStartY - touchEndY;

        // Vertical swipe only (up = next, down = previous)
        if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 50) {
            if (diffY > 0) {
                navigateFullscreen(1);   // swipe up → next
            } else {
                navigateFullscreen(-1);  // swipe down → previous
            }
        }
    }, { passive: true });

    const grid = document.getElementById('gallery-grid');
    const loader = document.getElementById('gallery-loader');
    const fullscreenContent = document.getElementById('fullscreen-content');
    const fullscreenTitle = document.getElementById('fullscreen-title');
    const galleryToggleButton = document.getElementById('btn-toggle-gallery');
    const sortSelect = document.getElementById('gallery-sort');
    const optionsButton = document.getElementById('btn-options');
    const optionsPanel = document.getElementById('gallery-options-panel');
    const seekSecondsInput = document.getElementById('gallery-seek-seconds');
    const flairFilterInput = document.getElementById('gallery-flair-filter');

    sortSelect.value = currentSort;
    seekSecondsInput.value = String(settings.seekSeconds);
    flairFilterInput.value = settings.flairFilter;

    document.getElementById('btn-all').addEventListener('click', () => setFilter('all'));
    document.getElementById('btn-images').addEventListener('click', () => setFilter('images'));
    document.getElementById('btn-videos').addEventListener('click', () => setFilter('videos'));
    sortSelect.addEventListener('change', () => setSort(sortSelect.value));
    optionsButton.addEventListener('click', toggleOptionsPanel);
    seekSecondsInput.addEventListener('change', updateSeekSeconds);
    flairFilterInput.addEventListener('change', updateFlairFilter);
    galleryToggleButton.addEventListener('click', toggleGalleryMode);
    launcher.addEventListener('click', () => {
        if (!galleryEnabled) {
            galleryEnabled = true;
            applyGalleryMode();
            if (posts.length === 0) {
                loadPosts();
            } else {
                scheduleFocusedVideoSync();
            }
            return;
        }
        toggleGalleryMode();
    });

    document.getElementById('fullscreen-close').addEventListener('click', closeFullscreen);

    window.addEventListener('keydown', (e) => {
        if (currentFullscreenIndex === -1) return;
        if (e.key === 'Escape') closeFullscreen();
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') navigateFullscreen(-1);
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigateFullscreen(1);
        else if (e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            togglePlayPause();
        } else if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            toggleFullscreenPlayback();
        } else if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            seekCurrentVideo(settings.seekSeconds);
        } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            seekCurrentVideo(-settings.seekSeconds);
        }
    }, true);

    fullscreenViewer.addEventListener('wheel', handleFullscreenWheel, { passive: false });
    fullscreenContent.addEventListener('wheel', handleFullscreenWheel, { passive: false });

    window.addEventListener('scroll', () => {
        if (!galleryEnabled || currentFullscreenIndex !== -1) return;
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 1000) {
            if (after && !loading) loadPosts();
        }
        scheduleFocusedVideoSync();
    }, { passive: true });

    window.addEventListener('resize', scheduleFocusedVideoSync);

    function getModhash() {
        const input = document.querySelector('input[name="uh"]');
        if (input && input.value) return input.value;
        if (window?.reddit?.config?.modhash) return window.reddit.config.modhash;
        if (window?.__r?.config?.modhash) return window.__r.config.modhash;
        return '';
    }

    function getInitialSort() {
        const params = new URLSearchParams(window.location.search);
        const querySort = params.get('sort');
        if (querySort) return querySort;
        const segments = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
        const knownSorts = new Set(['hot', 'new', 'top', 'rising', 'controversial', 'random', 'flair']);
        const found = segments.find(segment => knownSorts.has(segment));
        return found || 'hot';
    }

    function loadSettings() {
        try {
            const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
            return { ...DEFAULT_SETTINGS, ...parsed };
        } catch (_) {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function getListingPath() {
        const path = window.location.pathname.replace(/\/+$/, '') || '/';
        const segments = path.split('/').filter(Boolean);
        if (!segments.length) return '/';
        if (segments[0] === 'r' && segments[1]) {
            return `/${segments.slice(0, Math.min(4, segments.length)).join('/')}`;
        }
        if (segments[0] === 'all' || segments[0] === 'popular') {
            return `/${segments.slice(0, Math.min(3, segments.length)).join('/')}`;
        }
        if ((segments[0] === 'user' || segments[0] === 'u') && segments[1]) {
            if (segments[2]) {
                return `/${segments.slice(0, Math.min(4, segments.length)).join('/')}`;
            }
            return `/${segments.slice(0, 2).join('/')}/submitted`;
        }
        return path;
    }

    function shuffleArray(items) {
        const arr = items.slice();
        for (let i = arr.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function toggleGalleryMode() {
        galleryEnabled = !galleryEnabled;
        applyGalleryMode();
        if (galleryEnabled && posts.length === 0) {
            loadPosts();
        }
    }

    function applyGalleryMode() {
        document.body.classList.toggle('gallery-mode', galleryEnabled);
        galleryToggleButton.textContent = galleryEnabled ? 'Gallery On' : 'Gallery Off';
        galleryToggleButton.classList.toggle('gallery-primary', galleryEnabled);
        launcher.textContent = galleryEnabled ? 'Close Gallery' : 'Open Gallery';
        if (!galleryEnabled) {
            closeFullscreen();
            pauseAllGridVideos();
            optionsPanel.hidden = true;
        } else {
            scheduleFocusedVideoSync();
        }
    }

    function toggleOptionsPanel() {
        optionsPanel.hidden = !optionsPanel.hidden;
    }

    function updateSeekSeconds() {
        const value = Number.parseInt(seekSecondsInput.value, 10);
        const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 1), 120) : DEFAULT_SETTINGS.seekSeconds;
        settings.seekSeconds = clamped;
        seekSecondsInput.value = String(clamped);
        saveSettings();
    }

    function updateFlairFilter() {
        settings.flairFilter = flairFilterInput.value.trim();
        flairFilterInput.value = settings.flairFilter;
        saveSettings();
        if (currentSort === 'flair') {
            resetGalleryFeed();
            if (galleryEnabled) loadPosts();
        }
    }

    function setFilter(filter) {
        currentFilter = filter;
        document.querySelectorAll('#gallery-controls button').forEach(btn => {
            if (btn.id !== 'btn-toggle-gallery') btn.classList.remove('active');
        });
        document.getElementById(`btn-${filter}`).classList.add('active');
        grid.innerHTML = '';
        posts = [];
        after = null;
        focusedGridVideo = null;
        loadPosts();
    }

    function setSort(sort) {
        currentSort = sort;
        resetGalleryFeed();
        if (currentSort === 'flair') {
            optionsPanel.hidden = false;
            flairFilterInput.focus();
        }
        if (galleryEnabled) loadPosts();
    }

    function resetGalleryFeed() {
        grid.innerHTML = '';
        posts = [];
        after = null;
        focusedGridVideo = null;
        seenSourceKeys = new Set();
        pauseAllGridVideos();
    }

    function normalizeSourceUrl(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url, window.location.origin);
            parsed.hash = '';
            if (/youtu\.be$/i.test(parsed.hostname)) return `youtube:${parsed.pathname.replace(/\//g, '')}`;
            if (/youtube\.com$/i.test(parsed.hostname)) return `youtube:${parsed.searchParams.get('v') || parsed.pathname}`;
            if (/redgifs\.com$/i.test(parsed.hostname)) {
                const match = parsed.pathname.match(/\/watch\/([a-zA-Z0-9-]+)/);
                if (match) return `redgifs:${match[1].toLowerCase()}`;
            }
            parsed.search = '';
            return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
        } catch (_) {
            return String(url).trim().toLowerCase();
        }
    }

    function getSourceKey(post, media) {
        return normalizeSourceUrl(post.url_overridden_by_dest || post.url || media.url || media.previewUrl || post.permalink);
    }

    function htmlEscape(text) {
        return String(text || '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, '&#39;');
    }

    function getMediaUrl(post) {
        const url = post.url || post.url_overridden_by_dest || '';
        const previewUrl = getBestPreviewImage(post);
        if (url.includes('redgifs.com')) {
            const id = url.match(/redgifs\.com\/watch\/([a-zA-Z0-9-]+)/)?.[1];
            if (id) return { type: 'video', url, isRedgifs: true, id, previewUrl };
        }
        if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return { type: 'image', url, previewUrl: previewUrl || url };
        if (post.is_video && post.media?.reddit_video?.fallback_url) return { type: 'video', url: post.media.reddit_video.fallback_url, previewUrl };
        if (previewUrl) {
            if (url.includes('redgifs.com') || url.includes('v.redd.it')) return { type: 'video', url, previewUrl };
            return { type: 'image', url: previewUrl, previewUrl };
        }
        if (post.thumbnail && /^https?:\/\//i.test(post.thumbnail)) return { type: 'image', url: post.thumbnail, previewUrl: post.thumbnail };
        if (url.includes('v.redd.it')) return { type: 'video', url, previewUrl };
        if (url.includes('i.redd.it')) return { type: 'image', url, previewUrl: previewUrl || url };
        return null;
    }

    function getBestPreviewImage(post) {
        if (post.preview?.images?.[0]?.source?.url) return post.preview.images[0].source.url.replace(/&/g, '&');
        if (post.thumbnail && /^https?:\/\//i.test(post.thumbnail)) return post.thumbnail;
        return '';
    }

    function shouldIncludePost(media) {
        if (!media) return false;
        if (currentFilter === 'all') return true;
        if (currentFilter === 'images') return media.type === 'image';
        if (currentFilter === 'videos') return media.type === 'video';
        return false;
    }

    function matchesFlair(post) {
        if (currentSort !== 'flair') return true;
        const wanted = settings.flairFilter.trim().toLowerCase();
        if (!wanted) return true;
        const flair = String(post.link_flair_text || '').trim().toLowerCase();
        return flair === wanted;
    }

    async function loadPosts() {
        if (loading || !listingPath) return;
        loading = true;
        loader.style.display = 'block';
        loader.textContent = 'Loading...';
        try {
            const data = await fetchListingData();
            after = data.data.after;
            const children = currentSort === 'random' ? shuffleArray(data.data.children || []) : (data.data.children || []);
            children.forEach(child => {
                const post = child.data;
                const media = getMediaUrl(post);
                const sourceKey = media ? getSourceKey(post, media) : '';
                if (shouldIncludePost(media) && matchesFlair(post) && sourceKey && !seenSourceKeys.has(sourceKey)) {
                    seenSourceKeys.add(sourceKey);
                    const index = posts.length;
                    posts.push({ post, media });
                    renderPost(post, media, index);
                }
            });
            if (!after) {
                loader.textContent = 'No more posts';
                loader.style.display = 'block';
            } else {
                loader.style.display = 'none';
            }
            if (!posts.length) {
                loader.textContent = currentSort === 'flair' && settings.flairFilter ?
                    `No image/video posts found with flair "${settings.flairFilter}"` :
                    'No image/video posts found on this page yet';
                loader.style.display = 'block';
            }
        } catch (error) {
            console.error('Error loading posts:', error);
            loader.textContent = `Error loading posts: ${error.message}`;
            loader.style.display = 'block';
        }
        loading = false;
        scheduleFocusedVideoSync();
    }

    async function fetchListingData() {
        const origins = [window.location.origin, 'https://old.reddit.com', 'https://www.reddit.com'];
        let lastError = null;
        for (const origin of origins) {
            const baseUrl = `${origin}${listingPath}.json`;
            const params = new URLSearchParams({ raw_json: '1', limit: '100', sort: currentSort });
            if (currentSort === 'top' || currentSort === 'controversial') params.set('t', 'all');
            if (after) params.set('after', after);
            const url = `${baseUrl}?${params.toString()}`;
            try {
                const response = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } });
                if (!response.ok) throw new Error(`HTTP ${response.status} from ${origin}`);
                const data = await response.json();
                if (!data?.data?.children) throw new Error(`Listing JSON missing children from ${origin}`);
                return data;
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('Unable to load Reddit listing JSON');
    }

    function buildPostMeta(post) {
        const comments = typeof post.num_comments === 'number' ? `${post.num_comments} comments` : 'comments';
        const score = typeof post.score === 'number' ? `${post.score} points` : '';
        const author = post.author ? `u/${post.author}` : '';
        return [score, comments, author].filter(Boolean).join(' · ');
    }

    function renderPost(post, media, index) {
        const item = document.createElement('article');
        item.className = 'gallery-item';
        item.dataset.index = String(index);
        item.dataset.fullname = post.name || '';
        const permalink = `https://old.reddit.com${post.permalink}`;
        const saveLabel = post.saved ? 'Unsave' : 'Save';
        const upvoted = post.likes === true;
        const downvoted = post.likes === false;
        item.innerHTML = `
            ${media.type === 'video' ? '<video muted loop autoplay playsinline preload="metadata"></video>' : `<img src="${htmlEscape(media.previewUrl || media.url)}" alt="${htmlEscape(post.title)}">`}
            <div class="gallery-item-type">${htmlEscape(media.type)}</div>
            ${media.type === 'video' ? '<div class="gallery-item-audio">Muted</div>' : ''}
            <div class="gallery-item-title">${htmlEscape(post.title)}</div>
            <div class="gallery-item-meta">${htmlEscape(buildPostMeta(post))}</div>
            <div class="gallery-item-actions">
                <button type="button" class="js-upvote ${upvoted ? 'is-active' : ''}">Upvote</button>
                <button type="button" class="js-downvote ${downvoted ? 'is-active' : ''}">Downvote</button>
                <button type="button" class="js-save ${post.saved ? 'is-active' : ''}">${saveLabel}</button>
                <a class="js-comments" href="${htmlEscape(permalink)}" target="_blank" rel="noopener noreferrer">Comments</a>
            </div>
        `;
        if (media.type === 'video') {
            const video = item.querySelector('video');
            video.src = media.url;
            if (media.previewUrl) video.poster = media.previewUrl;
            video.muted = true;
            video.volume = 0;
        }
        item.querySelector('.js-upvote').addEventListener('click', (e) => { e.stopPropagation(); handleVote(item, post, 1); });
        item.querySelector('.js-downvote').addEventListener('click', (e) => { e.stopPropagation(); handleVote(item, post, -1); });
        item.querySelector('.js-save').addEventListener('click', (e) => { e.stopPropagation(); handleSave(item, post); });
        item.querySelector('.js-comments').addEventListener('click', (e) => { e.stopPropagation(); });
        item.addEventListener('click', (e) => {
            if (e.target.closest('.gallery-item-actions')) return;
            e.preventDefault();
            openFullscreen(index);
        });
        grid.appendChild(item);
    }

    async function redditApiPost(endpoint, params) {
        if (!modhash) throw new Error('Missing modhash');
        const body = new URLSearchParams({ uh: modhash, api_type: 'json', ...params });
        const response = await fetch(`https://old.reddit.com${endpoint}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body: body.toString(),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json().catch(() => ({}));
    }

    async function handleVote(item, post, dir) {
        try {
            await redditApiPost('/api/vote', { id: post.name, dir: String(dir) });
            post.likes = dir === 1 ? true : dir === -1 ? false : null;
            item.querySelector('.js-upvote').classList.toggle('is-active', post.likes === true);
            item.querySelector('.js-downvote').classList.toggle('is-active', post.likes === false);
        } catch (error) {
            console.error('Vote failed:', error);
        }
    }

    async function handleSave(item, post) {
        const endpoint = post.saved ? '/api/unsave' : '/api/save';
        try {
            await redditApiPost(endpoint, { id: post.name });
            post.saved = !post.saved;
            const saveButton = item.querySelector('.js-save');
            saveButton.textContent = post.saved ? 'Unsave' : 'Save';
            saveButton.classList.toggle('is-active', post.saved);
        } catch (error) {
            console.error('Save failed:', error);
        }
    }

    function openFullscreen(index) {
        pauseAllGridVideos();
        currentFullscreenIndex = index;
        fullscreenWheelLocked = false;
        document.body.classList.add('gallery-fullscreen-open');
        showFullscreenItem();
        fullscreenViewer.classList.add('active');
        focusFullscreenViewer();
        if (fullscreenViewer.requestFullscreen) {
            fullscreenViewer.requestFullscreen().catch(() => {});
        }
    }

    function closeFullscreen() {
        fullscreenViewer.classList.remove('active');
        document.body.classList.remove('gallery-fullscreen-open');
        currentFullscreenIndex = -1;
        fullscreenWheelLocked = false;
        if (currentVideo) {
            currentVideo.pause();
            currentVideo = null;
        }
        fullscreenContent.innerHTML = '';
        if (document.fullscreenElement) {
            document.exitFullscreen?.();
        }
        scheduleFocusedVideoSync();
    }

    function navigateFullscreen(direction) {
        currentFullscreenIndex += direction;
        if (currentFullscreenIndex < 0) currentFullscreenIndex = posts.length - 1;
        if (currentFullscreenIndex >= posts.length) currentFullscreenIndex = 0;
        showFullscreenItem();
        focusFullscreenViewer();
    }

    function pauseAllGridVideos() {
        document.querySelectorAll('#gallery-grid video').forEach(video => {
            video.pause();
            video.muted = true;
            video.volume = 0;
            updateAudioBadge(video, false);
        });
        focusedGridVideo = null;
        document.querySelectorAll('.gallery-item.is-focused').forEach(node => node.classList.remove('is-focused'));
    }

    function updateAudioBadge(video, isOn) {
        const item = video.closest('.gallery-item');
        const badge = item && item.querySelector('.gallery-item-audio');
        if (badge) badge.textContent = isOn ? 'Audio On' : 'Muted';
    }

    function getVisibleVideoItems() {
        return Array.from(document.querySelectorAll('#gallery-grid .gallery-item video')).map(video => {
            const item = video.closest('.gallery-item');
            const rect = item.getBoundingClientRect();
            return { video, item, rect };
        }).filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight);
    }

    function getFocusedVideo() {
        const items = getVisibleVideoItems();
        if (!items.length) return null;
        const activationLine = window.innerHeight * ACTIVATION_LINE_RATIO;
        let fallback = items[items.length - 1];
        for (const entry of items) {
            const midpoint = entry.rect.top + (entry.rect.height / 2);
            if (midpoint >= activationLine) return entry;
            fallback = entry;
        }
        return fallback;
    }

    function syncFocusedVideo() {
        scrollTicking = false;
        if (!galleryEnabled || currentFullscreenIndex !== -1) return;
        const focused = getFocusedVideo();
        document.querySelectorAll('.gallery-item.is-focused').forEach(node => node.classList.remove('is-focused'));
        if (!focused) {
            pauseAllGridVideos();
            return;
        }
        const { video, item } = focused;
        item.classList.add('is-focused');
        document.querySelectorAll('#gallery-grid video').forEach(other => {
            if (other !== video) {
                other.muted = true;
                other.volume = 0;
                updateAudioBadge(other, false);
            }
        });
        if (focusedGridVideo !== video) {
            if (focusedGridVideo) focusedGridVideo.pause();
            focusedGridVideo = video;
        }
        video.muted = false;
        video.volume = 1;
        updateAudioBadge(video, true);
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                video.muted = true;
                video.volume = 0;
                updateAudioBadge(video, false);
            });
        }
    }

    function scheduleFocusedVideoSync() {
        if (scrollTicking) return;
        scrollTicking = true;
        requestAnimationFrame(syncFocusedVideo);
    }

    function togglePlayPause() {
        if (!currentVideo) return;
        if (currentVideo.paused) currentVideo.play();
        else currentVideo.pause();
    }

    function toggleFullscreenPlayback() {
        if (!currentVideo) return;
        if (document.fullscreenElement === currentVideo) {
            document.exitFullscreen?.();
            return;
        }
        if (currentVideo.requestFullscreen) currentVideo.requestFullscreen().catch(() => {});
    }

    function seekCurrentVideo(deltaSeconds) {
        if (!currentVideo || typeof currentVideo.currentTime !== 'number') return;
        const duration = Number.isFinite(currentVideo.duration) ? currentVideo.duration : null;
        const nextTime = currentVideo.currentTime + deltaSeconds;
        if (duration !== null) {
            currentVideo.currentTime = Math.min(Math.max(nextTime, 0), duration);
        } else {
            currentVideo.currentTime = Math.max(nextTime, 0);
        }
    }

    function handleFullscreenWheel(e) {
        if (currentFullscreenIndex === -1) return;
        e.preventDefault();
        e.stopPropagation();
        if (fullscreenWheelLocked || !e.deltaY) return;
        fullscreenWheelLocked = true;
        if (e.deltaY > 0) navigateFullscreen(1);
        else navigateFullscreen(-1);
        window.setTimeout(() => { fullscreenWheelLocked = false; }, 220);
    }

    async function showFullscreenItem() {
        const { post, media } = posts[currentFullscreenIndex];
        fullscreenTitle.textContent = post.title;
        fullscreenTitle.href = `https://old.reddit.com${post.permalink}`;
        if (currentVideo) {
            currentVideo.pause();
            currentVideo = null;
        }
        fullscreenContent.innerHTML = '';
        if (media.isRedgifs) {
            try {
                const response = await fetch(`https://api.redgifs.com/v2/gifs/${media.id}`);
                const data = await response.json();
                const videoUrl = data.gif.urls.hd || data.gif.urls.sd;
                const video = document.createElement('video');
                video.src = videoUrl;
                video.controls = true;
                video.autoplay = true;
                video.loop = true;
                video.muted = true;
                video.style.maxWidth = '100%';
                video.style.maxHeight = '100%';
                video.style.objectFit = 'contain';
                fullscreenContent.appendChild(video);
                currentVideo = video;
            } catch (error) {
                const iframe = document.createElement('iframe');
                iframe.src = `https://www.redgifs.com/ifr/${media.id}`;
                iframe.allow = 'autoplay; fullscreen';
                fullscreenContent.appendChild(iframe);
            }
        } else if (media.type === 'video') {
            const video = document.createElement('video');
            video.src = media.url;
            video.controls = true;
            video.autoplay = true;
            video.loop = true;
            video.muted = false;
            video.style.maxWidth = '100%';
            video.style.maxHeight = '100%';
            video.style.objectFit = 'contain';
            fullscreenContent.appendChild(video);
            currentVideo = video;
        } else {
            const img = document.createElement('img');
            img.src = media.url;
            img.alt = post.title || '';
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.objectFit = 'contain';
            fullscreenContent.appendChild(img);
        }
        focusFullscreenViewer();
    }

    function focusFullscreenViewer() {
        if (currentFullscreenIndex === -1) return;
        window.requestAnimationFrame(() => {
            fullscreenViewer.focus({ preventScroll: true });
        });
    }

    applyGalleryMode();
})();
