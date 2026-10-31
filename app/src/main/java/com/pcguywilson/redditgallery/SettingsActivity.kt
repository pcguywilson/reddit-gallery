package com.pcguywilson.redditgallery

import android.content.Intent
import android.os.Bundle
import android.webkit.CookieManager
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.ListPreference
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import androidx.preference.PreferenceManager

class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction()
                .replace(android.R.id.content, SettingsFragment())
                .commit()
        }
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    fun finishWith(action: String) {
        setResult(RESULT_OK, Intent().putExtra(EXTRA_ACTION, action))
        finish()
    }

    class SettingsFragment : PreferenceFragmentCompat() {
        override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
            setPreferencesFromResource(R.xml.preferences, rootKey)
            val host = requireActivity() as SettingsActivity

            // Account status
            val user = PreferenceManager.getDefaultSharedPreferences(requireContext())
                .getString("username", "").orEmpty()
            val hasSession = CookieManager.getInstance()
                .getCookie(MainActivity.BASE)?.contains("reddit_session=") == true
            findPreference<Preference>("account")?.summary = when {
                user.isNotEmpty() -> "Logged in as u/$user"
                hasSession -> "Logged in"
                else -> "Not logged in"
            }

            // Startup feed choices: fixed feeds + every saved custom feed
            findPreference<ListPreference>("startup")?.let { lp ->
                val feeds = FeedStore(requireContext()).list().sortedBy { it.sortKey }
                lp.entries = (listOf("Last used", "r/all", "r/popular", "Front page") + feeds.map { it.display })
                    .toTypedArray()
                lp.entryValues = (listOf("last", "/r/all", "/r/popular", "/") + feeds.map { it.path })
                    .toTypedArray()
                if (lp.findIndexOfValue(lp.value) < 0) lp.value = "last"
            }

            findPreference<Preference>("login")?.setOnPreferenceClickListener {
                host.finishWith(ACTION_LOGIN); true
            }
            findPreference<Preference>("logout")?.setOnPreferenceClickListener {
                AlertDialog.Builder(requireContext())
                    .setTitle("Log out?")
                    .setMessage("This clears all WebView cookies.")
                    .setPositiveButton("Log out") { _, _ -> host.finishWith(ACTION_LOGOUT) }
                    .setNegativeButton("Cancel", null)
                    .show()
                true
            }
            findPreference<Preference>("clear_cache")?.setOnPreferenceClickListener {
                host.finishWith(ACTION_CLEAR_CACHE); true
            }
        }
    }

    companion object {
        const val EXTRA_ACTION = "action"
        const val ACTION_LOGIN = "login"
        const val ACTION_LOGOUT = "logout"
        const val ACTION_CLEAR_CACHE = "clear_cache"
    }
}
