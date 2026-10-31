package com.pcguywilson.redditgallery

import android.view.View
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import org.json.JSONArray
import org.json.JSONObject

/** Right panel: your Reddit account's multireddits (top) and subscriptions. */
class RightPanel(private val act: MainActivity) {
    private val list: LinearLayout = act.findViewById(R.id.right_list)
    private var multis: List<Feed>? = null
    private var subs: List<Feed>? = null
    private var loading = false
    private var error: String? = null

    init {
        act.findViewById<View>(R.id.right_refresh).setOnClickListener { load() }
    }

    fun onOpened() = if (subs == null && error == null) load() else render()

    fun invalidate() { multis = null; subs = null; error = null }

    private fun load() {
        if (loading) return
        if (!act.isLoggedIn()) { invalidate(); render(); return }
        loading = true
        error = null
        render()
        act.io.execute {
            try {
                val m = fetchMultis()
                val s = fetchSubs()
                act.runOnUiThread { multis = m; subs = s; loading = false; render() }
            } catch (e: Exception) {
                act.runOnUiThread { error = e.message ?: "unknown error"; loading = false; render() }
            }
        }
    }

    private fun render() {
        list.removeAllViews()
        if (!act.isLoggedIn()) {
            list.addView(Ui.hint(act, "Log in to load your subscriptions") { act.openLogin() })
            return
        }
        if (loading) { list.addView(Ui.hint(act, "Loading…")); return }
        error?.let { list.addView(Ui.hint(act, "Couldn't load ($it). Tap to retry") { load() }); return }

        val cur = act.currentPath()
        list.addView(Ui.section(act, "multireddits"))
        val m = multis.orEmpty()
        if (m.isEmpty()) list.addView(Ui.hint(act, "No multireddits"))
        m.forEach { f -> list.addView(Ui.item(act, f.display, cur.equals(f.path, true), { act.loadFeed(f.path) })) }

        list.addView(Ui.section(act, "subscriptions"))
        val s = subs.orEmpty()
        if (s.isEmpty()) list.addView(Ui.hint(act, "No subscriptions"))
        s.forEach { f ->
            list.addView(Ui.item(act, f.display, cur.equals(f.path, true), { act.loadFeed(f.path) }) {
                AlertDialog.Builder(act)
                    .setTitle(f.display)
                    .setItems(arrayOf("Add to my subreddits")) { _, _ -> act.left.addFeed(f) }
                    .show()
            })
        }
    }

    private fun fetchMultis(): List<Feed> {
        val arr = JSONArray(act.getJson("${MainActivity.BASE}/api/multi/mine.json?raw_json=1"))
        return (0 until arr.length()).map { arr.getJSONObject(it).getJSONObject("data") }
            .map { Feed("m/" + it.getString("display_name"), it.getString("path").trimEnd('/')) }
            .sortedBy { it.sortKey }
    }

    private fun fetchSubs(): List<Feed> {
        val nsfw = act.nsfwOn()
        val out = mutableListOf<Feed>()
        var after: String? = null
        var pages = 0
        do {
            val url = "${MainActivity.BASE}/subreddits/mine/subscriber.json?raw_json=1&limit=100" +
                (after?.let { "&after=$it" } ?: "")
            val data = JSONObject(act.getJson(url)).getJSONObject("data")
            val children = data.getJSONArray("children")
            for (i in 0 until children.length()) {
                val d = children.getJSONObject(i).getJSONObject("data")
                if (!nsfw && d.optBoolean("over18")) continue
                out.add(Feed(d.getString("display_name_prefixed"), d.getString("url").trimEnd('/')))
            }
            after = data.optString("after").takeIf { it.isNotEmpty() && it != "null" }
        } while (after != null && ++pages < 30)
        return out.sortedBy { it.sortKey }
    }
}
