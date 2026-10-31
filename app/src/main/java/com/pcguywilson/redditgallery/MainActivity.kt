package com.pcguywilson.redditgallery

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.drawerlayout.widget.DrawerLayout
import androidx.preference.PreferenceManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import android.webkit.JavascriptInterface

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var drawer: DrawerLayout
    private lateinit var fullscreenContainer: FrameLayout
    private lateinit var prefs: SharedPreferences
    lateinit var feeds: FeedStore
    lateinit var left: LeftPanel
    private lateinit var right: RightPanel
    val io = Executors.newSingleThreadExecutor()

    private lateinit var bootJs: String
    private lateinit var startJs: String
    private var userScript = ""
    private var userAgent = ""

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private val settingsLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
            applyWindowPrefs()
            applyNsfwCookie()
            right.invalidate()
            when (res.data?.getStringExtra(SettingsActivity.EXTRA_ACTION)) {
                SettingsActivity.ACTION_LOGIN -> openLogin()
                SettingsActivity.ACTION_LOGOUT -> clearCookies { web.loadUrl(startUrl()) }
                SettingsActivity.ACTION_CLEAR_CACHE -> {
                    web.clearCache(true)
                    web.clearHistory()
                    WebStorage.getInstance().deleteAllData()
                    toast("Cache cleared")
                    web.loadUrl(web.url ?: startUrl())
                }
                else -> web.reload() // settings may have changed; re-inject with new config
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        PreferenceManager.setDefaultValues(this, R.xml.preferences, false)
        prefs = PreferenceManager.getDefaultSharedPreferences(this)
        feeds = FeedStore(this)

        web = findViewById(R.id.web)
        drawer = findViewById(R.id.drawer)
        fullscreenContainer = findViewById(R.id.fullscreen_container)

        bootJs = assets.open("bootstrap.js").bufferedReader().use { it.readText() }
        startJs = assets.open("autostart.js").bufferedReader().use { it.readText() }
        userScript = loadUserScript()

        left = LeftPanel(this)
        right = RightPanel(this)

        // FAB: tap = right panel (your Reddit), long-press = left panel (app list). Left also opens by edge swipe.
        findViewById<View>(R.id.fab).apply {
            setOnClickListener { drawer.openDrawer(GravityCompat.END) }
            setOnLongClickListener { drawer.openDrawer(GravityCompat.START); true }
        }
        drawer.addDrawerListener(object : DrawerLayout.SimpleDrawerListener() {
            override fun onDrawerOpened(v: View) {
                if (v.id == R.id.panel_left) left.refresh() else right.onOpened()
            }
            override fun onDrawerClosed(v: View) {
                if (v.id == R.id.panel_left && left.isSearching()) left.closeSearch()
            }
        })

        setupWebView()
        applyWindowPrefs()
        applyNsfwCookie()
        setupBack()

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(startUrl())
    }

    /** External override (no rebuild needed) wins over the bundled asset. */
    private fun loadUserScript(): String {
        val override = getExternalFilesDir(null)?.let { File(it, "gallery.user.js") }
        if (override != null && override.isFile) return override.readText()
        return assets.open("gallery.user.js").bufferedReader().use { it.readText() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = false      // layout width = device width so the script's mobile CSS applies
            loadWithOverviewMode = false
            builtInZoomControls = false
            userAgentString = userAgentString.replace("; wv", "")
            userAgent = userAgentString
        }
        web.setBackgroundColor(Color.parseColor("#1A1A1B"))
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.addJavascriptInterface(Bridge(), "RGBridge")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                val scheme = u.scheme ?: return false
                if (scheme != "http" && scheme != "https") {
                    try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) { }
                    return true
                }
                if (u.host?.endsWith("reddit.com") == true && u.path?.contains("/comments/") == true) {
                    openInRedditApp(u)
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                pageHost = Uri.parse(url).host
                CookieManager.getInstance().flush()
                captureUsername()
                if (isListing(url)) {
                    prefs.edit().putString("last_url", url).apply()
                    inject()
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) { callback.onCustomViewHidden(); return }
                customView = view
                customViewCallback = callback
                fullscreenContainer.addView(view, FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                fullscreenContainer.visibility = View.VISIBLE
            }

            override fun onHideCustomView() = hideCustomView()

            // Avoid WebView's grey play-button poster
            override fun getDefaultVideoPoster(): Bitmap =
                Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        }
    }

    private fun hideCustomView() {
        val cb = customViewCallback ?: return
        customViewCallback = null
        customView = null
        fullscreenContainer.removeAllViews()
        fullscreenContainer.visibility = View.GONE
        cb.onCustomViewHidden()
    }

    private fun inject() {
        val cfg = JSONObject()
            .put("autoplay", prefs.getBoolean("autoplay", true))
            .put("muteDefault", prefs.getBoolean("mute_default", true))
            .put("nsfw", nsfwOn())
            .put("swipe", prefs.getString("swipe", "vertical"))
            .put("tapNav", prefs.getBoolean("tap_nav", false))
            .put("media", prefs.getString("media_filter", "all"))
        val js = buildString {
            append("window.__RG_CFG = ").append(cfg.toString()).append(";\n")
            append(bootJs).append("\n;\n")
            append("if (!window.__rgsLoaded) { window.__rgsLoaded = true;\n")
            append(userScript)
            append("\n}\n;\n")
            append(startJs)
        }
        web.evaluateJavascript(js, null)
    }

    private fun captureUsername() {
        web.evaluateJavascript(
            "(function(){var a=document.querySelector('#header-bottom-right .user a');return a?a.textContent:''})()"
        ) { r ->
            val name = try { JSONArray("[$r]").getString(0) } catch (_: Exception) { "" }
            if (name.isNotBlank()) prefs.edit().putString("username", name.trim()).apply()
        }
    }

    private fun openInRedditApp(u: Uri) {
        // Reddit app registers www.reddit.com links, not old.reddit.com
        val target = u.buildUpon().scheme("https").authority("www.reddit.com").build()
        try {
            startActivity(Intent(Intent.ACTION_VIEW, target).setPackage(REDDIT_PKG))
        } catch (_: ActivityNotFoundException) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, target))
            } catch (_: ActivityNotFoundException) {
                toast("No app can open Reddit links")
            }
        }
    }

    private fun isListing(url: String?): Boolean {
        val u = Uri.parse(url ?: return false)
        if (u.host != "old.reddit.com" && u.host != "www.reddit.com") return false
        val p = (u.path ?: "/").trimEnd('/').ifEmpty { "/" }
        if (p.contains("/comments/")) return false
        return p == "/" || p.startsWith("/r/") ||
            p == "/all" || p.startsWith("/all/") ||
            p == "/popular" || p.startsWith("/popular/") ||
            p.startsWith("/user/") || p.startsWith("/u/") || p.startsWith("/me/m/")
    }

    private fun startUrl(): String {
        val choice = prefs.getString("startup", "last") ?: "last"
        if (choice.startsWith("/")) return BASE + choice
        return prefs.getString("last_url", null)?.takeIf { isListing(it) } ?: "$BASE/r/all"
    }

    // ---------- Used by the panels ----------

    fun loadFeed(path: String) {
        drawer.closeDrawers()
        hideCustomView()
        web.loadUrl(BASE + path)
    }

    fun currentPath(): String =
        Uri.parse(web.url ?: "").path?.trimEnd('/')?.ifEmpty { "/" } ?: ""

    fun openSettings() {
        drawer.closeDrawers()
        settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
    }

    fun openLogin() {
        drawer.closeDrawers()
        right.invalidate()
        web.loadUrl("$BASE/login")
    }

    fun nsfwOn() = prefs.getBoolean("nsfw", false)

    fun isLoggedIn() = CookieManager.getInstance().getCookie(BASE)?.contains("reddit_session=") == true

    /**
     * Blocking GET with the WebView's reddit session. Call from [io].
     * Runs fetch() inside the page (same network stack and cookies as the feed) when an
     * old.reddit.com page is loaded; falls back to HttpURLConnection otherwise.
     */
    fun getJson(url: String): String {
        if (pageHost != "old.reddit.com") return httpGet(url)
        val id = fetchSeq.incrementAndGet()
        val req = PendingFetch()
        pendingFetches[id] = req
        val js = "fetch(${JSONObject.quote(url)},{credentials:'include',headers:{Accept:'application/json'}})" +
            ".then(function(r){return r.ok?r.text():Promise.reject(new Error('HTTP '+r.status))})" +
            ".then(function(t){RGBridge.result($id,true,t)},function(e){RGBridge.result($id,false,String(e&&e.message||e))})"
        runOnUiThread { web.evaluateJavascript(js, null) }
        try {
            if (!req.latch.await(30, TimeUnit.SECONDS)) throw RuntimeException("timed out")
        } finally {
            pendingFetches.remove(id)
        }
        if (!req.ok) throw RuntimeException(req.body)
        return req.body
    }

    private class PendingFetch {
        val latch = CountDownLatch(1)
        @Volatile var ok = false
        @Volatile var body = ""
    }

    private val pendingFetches = ConcurrentHashMap<Int, PendingFetch>()
    private val fetchSeq = AtomicInteger()
    @Volatile private var pageHost: String? = null

    private inner class Bridge {
        @JavascriptInterface
        fun result(id: Int, ok: Boolean, body: String) {
            pendingFetches[id]?.let { it.ok = ok; it.body = body; it.latch.countDown() }
        }
    }

    private fun httpGet(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 15000
            c.readTimeout = 20000
            c.setRequestProperty("Cookie", CookieManager.getInstance().getCookie(BASE) ?: "")
            c.setRequestProperty("User-Agent", userAgent)
            c.setRequestProperty("Accept", "application/json")
            if (c.responseCode != 200) throw RuntimeException("HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }

    fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    // ---------- Cookies / window ----------

    private fun applyNsfwCookie() {
        val cm = CookieManager.getInstance()
        val v = if (nsfwOn()) "over18=1; Domain=.reddit.com; Path=/; Max-Age=31536000"
        else "over18=; Domain=.reddit.com; Path=/; Max-Age=0"
        cm.setCookie(BASE, v)
        cm.flush()
    }

    private fun clearCookies(then: () -> Unit) {
        CookieManager.getInstance().removeAllCookies {
            CookieManager.getInstance().flush()
            prefs.edit().remove("username").apply()
            right.invalidate()
            applyNsfwCookie()
            toast("Logged out")
            then()
        }
    }

    private fun applyWindowPrefs() {
        if (prefs.getBoolean("keep_screen_on", false)) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val ctl = WindowCompat.getInsetsController(window, window.decorView)
        if (prefs.getBoolean("immersive", true)) {
            ctl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            ctl.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            ctl.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyWindowPrefs()
    }

    private fun setupBack() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (drawer.isDrawerOpen(GravityCompat.START)) {
                    if (left.isSearching()) left.closeSearch() else drawer.closeDrawer(GravityCompat.START)
                    return
                }
                if (drawer.isDrawerOpen(GravityCompat.END)) { drawer.closeDrawer(GravityCompat.END); return }
                if (customView != null) { hideCustomView(); return }
                web.evaluateJavascript("!!(window.__rgBack && window.__rgBack())") { r ->
                    if (r == "true") return@evaluateJavascript
                    if (web.canGoBack()) web.goBack() else finish()
                }
            }
        })
    }

    // ---------- Lifecycle ----------

    override fun onPause() {
        web.evaluateJavascript("document.querySelectorAll('video').forEach(function(v){v.pause()})", null)
        web.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }

    companion object {
        const val BASE = "https://old.reddit.com"
        const val REDDIT_PKG = "com.reddit.frontpage"
    }
}
