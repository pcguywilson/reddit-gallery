package com.pcguywilson.redditgallery

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView

/** Row builders shared by both panels. Styled after Gallery for Reddit. */
object Ui {
    val ORANGE = Color.parseColor("#FF5700")
    private val TEXT = Color.parseColor("#E8E8E8")
    private val MUTED = Color.parseColor("#7A7A7A")
    private val ACTIVE_BG = Color.parseColor("#2E2E2E")

    fun dp(ctx: Context, v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

    private fun ripple(ctx: Context): Int {
        val tv = TypedValue()
        ctx.theme.resolveAttribute(android.R.attr.selectableItemBackground, tv, true)
        return tv.resourceId
    }

    fun section(ctx: Context, title: String) = TextView(ctx).apply {
        text = title.uppercase()
        setTextColor(MUTED)
        textSize = 12f
        typeface = Typeface.DEFAULT_BOLD
        letterSpacing = 0.08f
        setPadding(dp(ctx, 16), dp(ctx, 18), dp(ctx, 16), dp(ctx, 6))
    }

    fun item(
        ctx: Context, label: String, active: Boolean,
        onClick: () -> Unit, onLong: (() -> Unit)? = null
    ) = TextView(ctx).apply {
        text = label
        textSize = 18f
        setTextColor(TEXT)
        isSingleLine = true
        setPadding(dp(ctx, 20), dp(ctx, 14), dp(ctx, 16), dp(ctx, 14))
        if (active) setBackgroundColor(ACTIVE_BG) else setBackgroundResource(ripple(ctx))
        setOnClickListener { onClick() }
        if (onLong != null) setOnLongClickListener { onLong(); true }
    }

    /** Row with a trailing "+" (search results you can add to your list). */
    fun itemWithAdd(ctx: Context, label: String, onClick: () -> Unit, onAdd: () -> Unit): View {
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        row.addView(item(ctx, label, false, onClick),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(TextView(ctx).apply {
            text = "+"
            textSize = 24f
            setTextColor(ORANGE)
            gravity = Gravity.CENTER
            setPadding(dp(ctx, 16), 0, dp(ctx, 16), 0)
            setBackgroundResource(ripple(ctx))
            contentDescription = "Add to my subreddits"
            setOnClickListener { onAdd() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return row
    }

    fun hint(ctx: Context, text: String, onClick: (() -> Unit)? = null) = TextView(ctx).apply {
        this.text = text
        textSize = 14f
        setTextColor(if (onClick != null) ORANGE else MUTED)
        setPadding(dp(ctx, 20), dp(ctx, 12), dp(ctx, 16), dp(ctx, 12))
        if (onClick != null) {
            setBackgroundResource(ripple(ctx))
            setOnClickListener { onClick() }
        }
    }
}
