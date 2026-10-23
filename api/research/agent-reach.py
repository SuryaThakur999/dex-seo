"""Internal Vercel Python function wrapping pinned Agent Reach v1.5.0
(commit 94f06c1969dfc1834001269d79d3ad0972d9dee6) for login-free research
channels: arbitrary web pages (Jina Reader), RSS/Atom feeds (feedparser),
and YouTube metadata/captions (yt-dlp).

Amendment 1 revision, e2aa89f: Agent Reach runs in production here, called
over an internal authenticated route by the Node ResearchJob pipeline. Every
URL has already passed safeFetch's allowlist/SSRF check in Node before it
reaches this function. This function never writes to the database -- it
only normalizes evidence and hands it back as JSON. Logged-in channels
(LinkedIn, X, Reddit, Facebook, Instagram) are out of scope here and are
never configured with cookies or accounts.

Contract (matches src/lib/research/providers/agent-reach-client.ts):
  Request:  POST {"channel": "web" | "rss" | "youtube", "url": "<string>"}
  Response: {"canonicalUrl", "title", "publishedAt" (ISO string or null),
             "excerpt", "sourceType", "agentReachVersion"}

  "rss" surfaces the feed's single most-recent entry as one document --
  Task 4/5 (Google News / trade-press connectors) decide whether multi-item
  consumption needs a different call shape; this function's job is the
  Agent Reach boundary itself, not those connectors' query logic.
"""

import json
import os
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

AGENT_REACH_VERSION = "1.5.0"
MAX_EXCERPT_CHARS = 20_000


class AgentReachError(Exception):
    pass


def _parse_title_from_jina_markdown(text: str) -> str | None:
    for line in text.splitlines()[:5]:
        stripped = line.strip()
        if stripped.lower().startswith("title:"):
            value = stripped.split(":", 1)[1].strip()
            return value or None
    return None


def _read_web(url: str) -> dict:
    from agent_reach.channels.web import WebChannel

    text = WebChannel().read(url)
    return {
        "canonicalUrl": url,
        "title": _parse_title_from_jina_markdown(text),
        "publishedAt": None,  # Jina Reader markdown carries no reliable date marker -- honest "undated"
        "excerpt": text[:MAX_EXCERPT_CHARS],
        "sourceType": "other",
    }


def _parse_rss_date(entry) -> str | None:
    parsed = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if not parsed:
        return None
    return datetime(*parsed[:6], tzinfo=timezone.utc).isoformat()


def _read_rss(url: str) -> dict:
    import feedparser

    parsed = feedparser.parse(url)
    if parsed.bozo and not parsed.entries:
        raise AgentReachError(f"RSS feed could not be parsed: {url}")
    if not parsed.entries:
        raise AgentReachError(f"RSS feed had no entries: {url}")

    latest = parsed.entries[0]
    description = getattr(latest, "summary", "") or getattr(latest, "description", "")
    return {
        "canonicalUrl": getattr(latest, "link", url),
        "title": getattr(latest, "title", None),
        "publishedAt": _parse_rss_date(latest),
        "excerpt": description[:MAX_EXCERPT_CHARS],
        "sourceType": "news",
    }


_VTT_TIMESTAMP_RE = re.compile(r"^\d{2}:\d{2}:\d{2}[.,]\d{3} -->.*$", re.MULTILINE)
_VTT_TAG_RE = re.compile(r"<[^>]+>")


def _strip_vtt(vtt_text: str) -> str:
    lines = []
    for line in vtt_text.splitlines():
        if line.strip().upper() == "WEBVTT" or _VTT_TIMESTAMP_RE.match(line) or line.strip().isdigit():
            continue
        cleaned = _VTT_TAG_RE.sub("", line).strip()
        if cleaned:
            lines.append(cleaned)
    # Captions repeat lines across overlapping cues -- collapse consecutive duplicates only,
    # never reorder or drop non-adjacent repeats (that would be inventing content).
    deduped = [line for i, line in enumerate(lines) if i == 0 or line != lines[i - 1]]
    return " ".join(deduped)


def _fetch_first_caption_text(info: dict) -> str:
    import urllib.request

    for track_map in (info.get("subtitles") or {}, info.get("automatic_captions") or {}):
        for lang in ("de", "en"):
            tracks = track_map.get(lang)
            if not tracks:
                continue
            vtt_tracks = [t for t in tracks if t.get("ext") == "vtt"]
            track = vtt_tracks[0] if vtt_tracks else tracks[0]
            try:
                with urllib.request.urlopen(track["url"], timeout=10) as resp:
                    return _strip_vtt(resp.read().decode("utf-8", errors="ignore"))
            except Exception:
                continue  # best-effort -- metadata alone is still a valid result without captions
    return ""


def _read_youtube(url: str) -> dict:
    import yt_dlp

    with yt_dlp.YoutubeDL({
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "writesubtitles": False,
    }) as ydl:
        info = ydl.extract_info(url, download=False)

    upload_date = info.get("upload_date")  # YYYYMMDD or None
    published_at = None
    if upload_date and len(upload_date) == 8:
        published_at = datetime.strptime(upload_date, "%Y%m%d").replace(tzinfo=timezone.utc).isoformat()

    description = info.get("description") or ""
    captions = _fetch_first_caption_text(info)
    excerpt = (description + ("\n\n" + captions if captions else "")).strip()

    return {
        "canonicalUrl": info.get("webpage_url", url),
        "title": info.get("title"),
        "publishedAt": published_at,
        "excerpt": excerpt[:MAX_EXCERPT_CHARS],
        "sourceType": "other",
        "hasCaptions": bool(captions),
    }


MAX_LISTED_VIDEOS = 10


def _list_youtube(url: str) -> dict:
    """Task 23: lists a channel's recent uploads. Uses yt_dlp's flat extraction (metadata
    only, no per-video download) so listing stays cheap -- the opposite of _read_youtube,
    which does a full per-video extraction for exactly one video the caller already chose.
    Flat entries rarely carry an upload date; publishedAt is honestly null when absent,
    same convention as every other undated source in this phase."""
    import yt_dlp

    with yt_dlp.YoutubeDL({
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "playlistend": MAX_LISTED_VIDEOS,
    }) as ydl:
        info = ydl.extract_info(url, download=False)

    entries = (info.get("entries") or [])[:MAX_LISTED_VIDEOS]
    videos = []
    for entry in entries:
        upload_date = entry.get("upload_date") or entry.get("release_date")
        published_at = None
        if upload_date and len(upload_date) == 8:
            published_at = datetime.strptime(upload_date, "%Y%m%d").replace(tzinfo=timezone.utc).isoformat()
        videos.append({"id": entry.get("id"), "title": entry.get("title"), "publishedAt": published_at})
    return {"videos": videos}


_READERS = {"web": _read_web, "rss": _read_rss, "youtube": _read_youtube}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        expected_secret = os.environ.get("AGENT_REACH_INTERNAL_SECRET")
        provided_secret = self.headers.get("x-agent-reach-secret")
        if not expected_secret or provided_secret != expected_secret:
            self._respond(401, {"error": "unauthorized"})
            return

        length = int(self.headers.get("content-length", 0))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._respond(400, {"error": "invalid JSON body"})
            return

        channel = payload.get("channel")
        url = payload.get("url")
        mode = payload.get("mode") or "read"

        if not isinstance(url, str) or not url:
            self._respond(400, {"error": "url must be a non-empty string"})
            return

        if channel == "youtube" and mode == "list":
            try:
                result = _list_youtube(url)
            except Exception as err:
                self._respond(502, {"error": str(err)})
                return
            result["agentReachVersion"] = AGENT_REACH_VERSION
            self._respond(200, result)
            return

        reader = _READERS.get(channel)
        if reader is None:
            self._respond(400, {"error": "channel must be one of web/rss/youtube, url must be a non-empty string"})
            return

        try:
            result = reader(url)
        except Exception as err:  # a failed channel never crashes the function -- caller treats this as a per-channel failure
            self._respond(502, {"error": str(err)})
            return

        result["agentReachVersion"] = AGENT_REACH_VERSION
        self._respond(200, result)

    def _respond(self, status: int, body: dict):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
