import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import chaya_comment_dm_watchdog as watchdog


class ChayaCommentDmWatchdogTest(unittest.TestCase):
    def test_keyword_matching_is_whole_word_and_case_insensitive(self):
        keywords = {name: {} for name in ["MOON", "TOWER", "DEATH", "DEVIL", "SWORDS"]}
        self.assertEqual(watchdog.keyword_in("moon please", keywords), "MOON")
        self.assertEqual(watchdog.keyword_in("The TOWER!", keywords), "TOWER")
        self.assertIsNone(watchdog.keyword_in("moonlight", keywords))
        self.assertIsNone(watchdog.keyword_in("swordsmith", keywords))

    def test_only_comments_between_ten_minutes_and_six_days_are_checked(self):
        now = datetime.now(timezone.utc)
        stamp = lambda delta: (now - delta).isoformat()
        self.assertFalse(watchdog.in_watch_window(stamp(timedelta(minutes=9)), now))
        self.assertTrue(watchdog.in_watch_window(stamp(timedelta(minutes=10)), now))
        self.assertTrue(watchdog.in_watch_window(stamp(timedelta(days=5)), now))
        self.assertFalse(watchdog.in_watch_window(stamp(timedelta(days=7)), now))

    def test_successful_log_ids_are_loaded_without_exposing_records(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "log.jsonl"
            path.write_text(
                "\n".join([
                    json.dumps({"comment_id": "sent", "ok": True}),
                    json.dumps({"comment_id": "failed", "ok": False}),
                    "not json",
                ]),
                encoding="utf-8",
            )
            self.assertEqual(watchdog.successful_comment_ids(str(path)), {"sent"})


if __name__ == "__main__":
    unittest.main()
