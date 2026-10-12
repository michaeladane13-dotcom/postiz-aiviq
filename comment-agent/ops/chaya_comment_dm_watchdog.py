#!/usr/bin/env python3
"""Public-only watchdog for missed Chaya keyword DMs.

This is intentionally separate from comment_dm_bot.py and never sends a private
message. It reads that bot's append-only log, waits ten minutes, and posts the
approved message-request reminder only when no successful log record exists.
"""

import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone


CONFIG = "/etc/chaya-marketing/comment_dm.json"
BOT_LOG = "/var/lib/chaya-marketing/comment_dm_log.jsonl"
STATE = "/var/lib/chaya-marketing/comment_dm_watchdog_state.json"
MISS_LOG = "/var/lib/chaya-marketing/comment_dm_misses.jsonl"
TOKEN_FILE = "/etc/chaya-marketing/meta_chaya_page_token"
GRAPH = "https://graph.facebook.com/v21.0/"
MIN_AGE = timedelta(minutes=10)
MAX_AGE = timedelta(days=6)
MISSED_REPLY = "Have a look in your message requests, it is on its way."


def graph_call(path, params=None, method="GET", token=""):
    values = dict(params or {})
    values["access_token"] = token
    data = urllib.parse.urlencode(values).encode()
    try:
        if method == "GET":
            with urllib.request.urlopen(GRAPH + path + "?" + data.decode(), timeout=60) as response:
                return json.load(response)
        request = urllib.request.Request(GRAPH + path, data=data, method="POST")
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        return {"error": error.read().decode()[:300]}
    except Exception as error:
        return {"error": str(error)[:300]}


def keyword_in(text, keywords):
    source = str(text or "").upper()
    for keyword in keywords:
        if re.search(r"(?<![A-Z])" + re.escape(keyword.upper()) + r"(?![A-Z])", source):
            return keyword
    return None


def parse_meta_time(value):
    return datetime.fromisoformat(str(value).replace("+0000", "+00:00"))


def in_watch_window(created_at, now):
    age = now - parse_meta_time(created_at)
    return MIN_AGE <= age <= MAX_AGE


def successful_comment_ids(path=BOT_LOG):
    successful = set()
    if not os.path.exists(path):
        return successful
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("ok") is True and record.get("comment_id"):
                successful.add(str(record["comment_id"]))
    return successful


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json_atomic(path, value):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".comment-dm-watchdog-", dir=directory)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def append_miss(record, path=MISS_LOG):
    record = dict(record)
    record["at"] = datetime.now(timezone.utc).isoformat()
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


def public_reply_already_exists(comment_id, channel, expected_texts, token):
    result = graph_call(
        comment_id + ("/replies" if channel == "instagram" else "/comments"),
        {"fields": "id,message,text", "limit": 50},
        token=token,
    )
    if "error" in result:
        return False
    normalized = {str(value or "").strip() for value in expected_texts}
    return any(
        str(reply.get("message") or reply.get("text") or "").strip() in normalized
        for reply in result.get("data", [])
    )


def handle_candidate(candidate, successful, handled, public_texts, token):
    comment_id = str(candidate["comment_id"])
    if comment_id in successful or comment_id in handled:
        return False
    if public_reply_already_exists(comment_id, candidate["channel"], public_texts, token):
        handled[comment_id] = {
            "status": "public_reply_already_present",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
        return False

    result = graph_call(
        comment_id + ("/replies" if candidate["channel"] == "instagram" else "/comments"),
        {"message": MISSED_REPLY},
        "POST",
        token,
    )
    ok = "error" not in result
    handled[comment_id] = {
        "status": "fallback_posted" if ok else "fallback_failed",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "error": result.get("error"),
    }
    append_miss({**candidate, "ok": ok, "error": result.get("error")})
    return ok


def instagram_candidates(config, token, now):
    account = str(config["instagram_user_id"])
    media = graph_call(
        account + "/media",
        {"fields": "id,timestamp", "limit": config.get("max_posts", 25)},
        token=token,
    ).get("data", [])
    for item in media:
        comments = graph_call(
            item["id"] + "/comments",
            {"fields": "id,text,timestamp,username,from", "limit": 100},
            token=token,
        ).get("data", [])
        for comment in comments:
            keyword = keyword_in(comment.get("text"), config["keywords"])
            if keyword and in_watch_window(comment["timestamp"], now):
                yield {
                    "channel": "instagram",
                    "keyword": keyword,
                    "username": comment.get("username") or "",
                    "comment_id": str(comment["id"]),
                    "post_id": str(item["id"]),
                }


def facebook_candidates(config, token, now):
    page = str(config["page_id"])
    posts = graph_call(
        page + "/posts",
        {"fields": "id,created_time", "limit": config.get("max_posts", 25)},
        token=token,
    ).get("data", [])
    for post in posts:
        comments = graph_call(
            post["id"] + "/comments",
            {"fields": "id,message,created_time,from", "limit": 100},
            token=token,
        ).get("data", [])
        for comment in comments:
            sender_id = str((comment.get("from") or {}).get("id") or "")
            keyword = keyword_in(comment.get("message"), config["keywords"])
            if sender_id != page and keyword and in_watch_window(comment["created_time"], now):
                yield {
                    "channel": "facebook",
                    "keyword": keyword,
                    "user_id": sender_id,
                    "comment_id": str(comment["id"]),
                    "post_id": str(post["id"]),
                }


def main(dry_run=False):
    config = load_json(CONFIG, {})
    if not config.get("keywords"):
        raise RuntimeError("The existing keyword configuration could not be read")
    with open(TOKEN_FILE, encoding="utf-8") as handle:
        token = handle.read().strip()
    state = load_json(STATE, {"handled": {}})
    handled = state.setdefault("handled", {})
    successful = successful_comment_ids()
    public_texts = [
        value.get("public_reply", "") for value in config["keywords"].values()
    ] + [MISSED_REPLY]
    now = datetime.now(timezone.utc)
    posted = 0
    candidates = list(instagram_candidates(config, token, now)) + list(
        facebook_candidates(config, token, now)
    )
    if dry_run:
        missing = [
            candidate for candidate in candidates
            if candidate["comment_id"] not in successful
            and candidate["comment_id"] not in handled
            and not public_reply_already_exists(
                candidate["comment_id"], candidate["channel"], public_texts, token
            )
        ]
        by_channel = {
            channel: sum(item["channel"] == channel for item in missing)
            for channel in ("instagram", "facebook")
        }
        print(json.dumps({"dry_run": True, "missing_count": len(missing), "by_channel": by_channel}))
        return
    for candidate in candidates:
        posted += int(handle_candidate(candidate, successful, handled, public_texts, token))
        time.sleep(1)
    save_json_atomic(STATE, state)
    print(f"{now:%Y-%m-%d %H:%M} missed keyword public replies posted {posted}")


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
