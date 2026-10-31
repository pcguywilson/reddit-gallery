package com.pcguywilson.redditgallery

import android.content.ClipData
import android.content.Context
import android.view.DragEvent
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import org.json.JSONObject
import java.net.URLEncoder

/** Left panel: the app's own subreddit list, A-Z index, search, random, settings. */
class LeftPanel(private val act: MainActivity) {
    private val list: LinearLayout = act.findViewById(R.id.left_list)
    private val scroll: ScrollView = act.findViewById(R.id.left_scroll)
    private val index: LinearLayout = act.findViewById(R.id.left_index)
    private val search: EditText = act.findViewById(R.id.left_search)
    private val handler = Handler(Looper.getMainLooper())
    private var searchGen = 0
    private val letterRows = sortedMapOf<Char, View>()

    init {
        act.findViewById<View>(R.id.left_add).setOnClickListener { promptAdd() }
        act.findViewById<View>(R.id.left_search_btn).setOnClickListener {
            if (isSearching()) closeSearch() else openSearch()
        }
        act.findViewById<View>(R.id.left_random).setOnClickListener { random() }
        act.findViewById<View>(R.id.left_sort).setOnClickListener { toggleSort() }
        act.findViewById<View>(R.id.left_settings).setOnClickListener { act.openSettings() }

        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { if (isSearching()) onQuery(s.toString()) }
        })
        search.setOnEditorActionListener { _, _, _ ->
            FeedStore.parseAny(search.text.toString())?.let { act.loadFeed(it.path) }
            true
        }
        buildIndex()
    }

    fun isSearching() = search.visibility == View.VISIBLE

    fun refresh() = if (isSearching()) onQuery(search.text.toString()) else render("")

    private fun openSearch() {
        search.visibility = View.VISIBLE
        index.visibility = View.GONE
        search.requestFocus()
        imm().showSoftInput(search, InputMethodManager.SHOW_IMPLICIT)
    }

    fun closeSearch() {
        imm().hideSoftInputFromWindow(search.windowToken, 0)
        search.visibility = View.GONE
        search.setText("")
        index.visibility = View.VISIBLE
        handler.removeCallbacksAndMessages(null)
        searchGen++
        render("")
    }

    private fun imm() = act.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager

    private fun render(query: String) {
        list.removeAllViews()
        letterRows.clear()
        scroll.scrollTo(0, 0)
        val cur = act.currentPath()
        val q = query.trim().lowercase().removePrefix("/").removePrefix("r/")

        if (q.isEmpty()) {
            PINNED.forEach { (label, path) ->
                list.addView(Ui.item(act, label, cur.equals(path, true), { act.loadFeed(path) }))
            }
        }

        val alpha = act.feeds.sortAlpha
        index.visibility = if (alpha && !isSearching()) View.VISIBLE else View.GONE
        val stored = act.feeds.list()
        val mine = if (alpha) stored.sortedBy { it.sortKey } else stored
        val shown = if (q.isEmpty()) mine else mine.filter { it.display.lowercase().contains(q) }
        val draggable = !alpha && q.isEmpty()

        shown.forEachIndexed { i, f ->
            val item = Ui.item(act, f.display, cur.equals(f.path, true), { act.loadFeed(f.path) }) { itemMenu(f, i, draggable) }
            val row = if (draggable) dragRow(item, i) else item
            if (alpha) {
                val c = f.sortKey.firstOrNull() ?: '#'
                letterRows.putIfAbsent(if (c in 'a'..'z') c else '#', row)
            }
            list.addView(row)
        }
        if (q.isEmpty() && mine.isEmpty()) list.addView(Ui.hint(act, "Tap + to add a subreddit"))
        if (q.isEmpty()) list.addView(Ui.hint(act,
            if (alpha) "Sorted A-Z. Tap the sort button for your own order. Long-press to remove."
            else "Drag ≡ to reorder. Long-press for more. Tap the sort button for A-Z."))
    }

    // ---------- Custom order: drag handle + long-press moves ----------

    private fun dragRow(item: View, i: Int): View {
        val row = LinearLayout(act).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        row.addView(item, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val handle = TextView(act).apply {
            text = "≡"
            textSize = 24f
            setTextColor(0xFF7A7A7A.toInt())
            gravity = android.view.Gravity.CENTER
            setPadding(Ui.dp(act, 16), 0, Ui.dp(act, 16), 0)
            contentDescription = "Drag to reorder"
        }
        row.addView(handle, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT))

        @Suppress("ClickableViewAccessibility")
        handle.setOnTouchListener { _, e ->
            if (e.action == MotionEvent.ACTION_DOWN) {
                row.startDragAndDrop(ClipData.newPlainText("feed", i.toString()), View.DragShadowBuilder(row), i, 0)
                true
            } else false
        }
        row.setOnDragListener { v, e ->
            when (e.action) {
                DragEvent.ACTION_DRAG_STARTED -> true
                DragEvent.ACTION_DRAG_ENTERED -> { v.setBackgroundColor(0xFF3A2A20.toInt()); true }
                DragEvent.ACTION_DRAG_EXITED, DragEvent.ACTION_DRAG_ENDED -> { v.background = null; true }
                DragEvent.ACTION_DRAG_LOCATION -> {
                    // Auto-scroll near the top/bottom of the panel
                    val y = v.top + e.y - scroll.scrollY
                    val edge = Ui.dp(act, 56)
                    if (y < edge) scroll.scrollBy(0, -Ui.dp(act, 12))
                    else if (y > scroll.height - edge) scroll.scrollBy(0, Ui.dp(act, 12))
                    true
                }
                DragEvent.ACTION_DROP -> {
                    val from = e.localState as? Int
                    if (from != null && from != i) {
                        act.feeds.move(from, i)
                        list.post { render("") }
                    }
                    true
                }
                else -> true
            }
        }
        return row
    }

    private fun itemMenu(f: Feed, i: Int, draggable: Boolean) {
        val opts = if (draggable) arrayOf("Move to top", "Move to bottom", "Remove") else arrayOf("Remove")
        AlertDialog.Builder(act)
            .setTitle(f.display)
            .setItems(opts) { _, which ->
                when (opts[which]) {
                    "Move to top" -> { act.feeds.move(i, 0); render("") }
                    "Move to bottom" -> { act.feeds.move(i, Int.MAX_VALUE); render("") }
                    "Remove" -> confirmRemove(f)
                }
            }
            .show()
    }

    private fun toggleSort() {
        val toAlpha = !act.feeds.sortAlpha
        act.feeds.sortAlpha = toAlpha
        act.toast(if (toAlpha) "Sorted A-Z" else "Custom order: drag ≡ to reorder")
        render("")
    }

    // ---------- A-Z index (tap or drag) ----------

    private fun buildIndex() {
        LETTERS.forEach { ch ->
            index.addView(TextView(act).apply {
                text = ch.toString()
                textSize = 14f
                setTextColor(0xFFE8E8E8.toInt())
                gravity = android.view.Gravity.CENTER
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        index.setOnTouchListener { v, e ->
            if (e.action == MotionEvent.ACTION_DOWN || e.action == MotionEvent.ACTION_MOVE) {
                val i = (e.y / v.height * LETTERS.length).toInt().coerceIn(0, LETTERS.length - 1)
                jump(LETTERS[i])
            }
            true
        }
    }

    private fun jump(ch: Char) {
        if (ch == '#') { scroll.scrollTo(0, 0); return }
        val target = letterRows.tailMap(ch).values.firstOrNull() ?: letterRows.values.lastOrNull() ?: return
        scroll.scrollTo(0, target.top)
    }

    // ---------- Search ----------

    private fun onQuery(text: String) {
        render(text)
        handler.removeCallbacksAndMessages(null)
        val gen = ++searchGen
        val q = text.trim().removePrefix("/").removePrefix("r/")
        if (q.length < 2) return
        FeedStore.parseAny(q)?.let { f ->
            list.addView(Ui.section(act, "go to"))
            list.addView(Ui.itemWithAdd(act, f.display, { act.loadFeed(f.path) }) { addFeed(f) })
        }
        handler.postDelayed({ remoteSearch(q, gen) }, 400)
    }

    private fun remoteSearch(q: String, gen: Int) {
        val nsfw = act.nsfwOn()
        val url = "${MainActivity.BASE}/subreddits/search.json?raw_json=1&limit=25&q=" +
            URLEncoder.encode(q, "UTF-8") + if (nsfw) "&include_over_18=on" else ""
        act.io.execute {
            val names: List<String>? = try {
                val children = JSONObject(act.getJson(url)).getJSONObject("data").getJSONArray("children")
                (0 until children.length()).map { children.getJSONObject(it).getJSONObject("data") }
                    .filter { nsfw || !it.optBoolean("over18") }
                    .map { it.getString("display_name") }
            } catch (_: Exception) { null }
            act.runOnUiThread {
                if (gen != searchGen || !isSearching()) return@runOnUiThread
                list.addView(Ui.section(act, "reddit"))
                when {
                    names == null -> list.addView(Ui.hint(act, "Search failed"))
                    names.isEmpty() -> list.addView(Ui.hint(act, "No subreddits found"))
                    else -> names.forEach { n ->
                        list.addView(Ui.itemWithAdd(act, n, { act.loadFeed("/r/$n") }) { addFeed(Feed("r/$n", "/r/$n")) })
                    }
                }
            }
        }
    }

    // ---------- Add / remove / random ----------

    fun addFeed(f: Feed) {
        act.toast(if (act.feeds.add(f)) "Added ${f.display}" else "${f.display} is already in your list")
        if (!isSearching()) render("")
    }

    private fun confirmRemove(f: Feed) {
        // A-Z mode long-press goes straight here; custom mode comes via itemMenu.
        AlertDialog.Builder(act)
            .setTitle("Remove ${f.display}?")
            .setPositiveButton("Remove") { _, _ -> act.feeds.remove(f); refresh() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun promptAdd() {
        val input = EditText(act).apply {
            hint = "pics, pics+aww, or a multireddit URL"
            isSingleLine = true
        }
        val box = FrameLayout(act).apply {
            setPadding(Ui.dp(act, 20), Ui.dp(act, 8), Ui.dp(act, 20), 0)
            addView(input)
        }
        AlertDialog.Builder(act)
            .setTitle("Add subreddit")
            .setView(box)
            .setPositiveButton("Add") { _, _ ->
                val text = input.text.toString()
                FeedStore.parseAny(text)?.let { addFeed(it) } ?: act.toast("Couldn't parse \"$text\"")
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun random() {
        val mine = act.feeds.list()
        act.loadFeed(if (mine.isEmpty()) "/r/random" else mine.random().path)
    }

    companion object {
        private const val LETTERS = "#abcdefghijklmnopqrstuvwxyz"
        private val PINNED = listOf("frontpage" to "/", "all" to "/r/all", "popular" to "/r/popular")
    }
}
