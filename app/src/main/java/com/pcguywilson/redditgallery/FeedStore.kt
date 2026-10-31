package com.pcguywilson.redditgallery

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class Feed(val label: String, val path: String) {
    /** Name shown in lists: "pics" for subs, "m/name" for multis. */
    val display: String get() = label.removePrefix("r/")
    val sortKey: String get() = display.removePrefix("m/").removePrefix("u/").lowercase()
}

/** The app's own subreddit list (left panel), stored as JSON in SharedPreferences. */
class FeedStore(context: Context) {
    private val prefs = context.getSharedPreferences("feeds", Context.MODE_PRIVATE)

    init {
        if (!prefs.getBoolean("seeded", false)) {
            save(DEFAULTS.map { Feed("r/$it", "/r/$it") })
            prefs.edit().putBoolean("seeded", true).apply()
        }
    }

    fun list(): MutableList<Feed> {
        val arr = JSONArray(prefs.getString(KEY, "[]"))
        return MutableList(arr.length()) {
            val o = arr.getJSONObject(it)
            Feed(o.getString("label"), o.getString("path"))
        }
    }

    fun save(feeds: List<Feed>) {
        val arr = JSONArray()
        feeds.forEach { arr.put(JSONObject().put("label", it.label).put("path", it.path)) }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    fun add(feed: Feed): Boolean {
        val l = list()
        if (l.any { it.path.equals(feed.path, ignoreCase = true) }) return false
        l.add(feed)
        save(l)
        return true
    }

    fun remove(feed: Feed) = save(list().filterNot { it.path.equals(feed.path, ignoreCase = true) })

    /** true = A-Z, false = your own drag order. */
    var sortAlpha: Boolean
        get() = prefs.getBoolean("sort_alpha", true)
        set(v) {
            // First switch to custom starts from the A-Z order rather than insertion order.
            if (!v && !prefs.getBoolean("custom_init", false)) {
                save(list().sortedBy { it.sortKey })
                prefs.edit().putBoolean("custom_init", true).apply()
            }
            prefs.edit().putBoolean("sort_alpha", v).apply()
        }

    fun move(from: Int, to: Int) {
        val l = list()
        if (from !in l.indices) return
        val f = l.removeAt(from)
        l.add(to.coerceIn(0, l.size), f)
        save(l)
    }

    companion object {
        private const val KEY = "subs"
        val DEFAULTS = listOf(
            "pics", "aww", "EarthPorn", "gifs", "videos",
            "mildlyinteresting", "oddlysatisfying", "interestingasfuck"
        )

        /** Multireddit if it contains "/m/", otherwise a subreddit. */
        fun parseAny(input: String): Feed? =
            if (input.contains("/m/")) parseMulti(input) else parseSub(input)

        /** Accepts "pics", "r/pics", "/r/pics", "pics+aww", or a full reddit URL. */
        fun parseSub(input: String): Feed? {
            var s = input.trim()
            if (s.contains("reddit.com")) s = s.substringAfter("reddit.com")
            s = s.trim('/').removePrefix("r/").trim('/').substringBefore('/')
            if (!Regex("[A-Za-z0-9_+]{2,}").matches(s)) return null
            return Feed("r/$s", "/r/$s")
        }

        /** Accepts a full multireddit URL, "user/NAME/m/MULTI", "NAME/m/MULTI" or "me/m/MULTI". */
        fun parseMulti(input: String): Feed? {
            var s = input.trim()
            if (s.contains("reddit.com")) s = s.substringAfter("reddit.com")
            val p = s.substringBefore('?').split('/').filter { it.isNotEmpty() }
            val ok = Regex("[A-Za-z0-9_-]+")
            var user: String? = null
            val name: String
            when {
                p.size >= 4 && (p[0] == "user" || p[0] == "u") && p[2] == "m" -> { user = p[1]; name = p[3] }
                p.size >= 3 && p[0] == "me" && p[1] == "m" -> name = p[2]
                p.size == 3 && p[1] == "m" -> { user = p[0]; name = p[2] }
                else -> return null
            }
            if (!ok.matches(name) || (user != null && !ok.matches(user))) return null
            return if (user == null) Feed("m/$name", "/me/m/$name")
            else Feed("m/$name", "/user/$user/m/$name")
        }
    }
}
