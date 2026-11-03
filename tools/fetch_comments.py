"""
🏝 Остров подписчиков — сбор жителей из комментариев Instagram.

Берёт рилсы аккаунта через Instagram API (Instagram Login), собирает авторов
комментариев и пишет:
  residents.json  — жители по порядку первого коммента (ник, номер, дата, рилс)
  comments.json   — все комменты целиком (для выбора названия острова и т.п.)

Запуск:
  python fetch_comments.py            # все рилсы
  python fetch_comments.py --last 1   # только последний рилс
  python fetch_comments.py --refresh  # продлить токен ещё на 60 дней

Токен лежит в config.json рядом со скриптом (см. SETUP.md) или в переменных окружения
IG_TOKEN / IG_USER_ID (так работает GitHub Actions). Только стандартная библиотека.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1251
# Instagram-login tokens start with "IG" and live on graph.instagram.com; unified-login
# (business portfolio / system user) tokens start with "EAA" and use graph.facebook.com
API = "https://graph.instagram.com"
BUSINESS_ID = "2184611392409123"  # бизнес-портфолио «Остров подписчиков»


def load_config():
    if os.environ.get("IG_TOKEN"):
        return {"IG_TOKEN": os.environ["IG_TOKEN"], "IG_USER_ID": os.environ.get("IG_USER_ID", "")}
    f = HERE / "config.json"
    if not f.exists():
        sys.exit("Нет config.json — скопируй config.example.json в config.json и вставь токен (см. SETUP.md)")
    cfg = json.loads(f.read_text(encoding="utf-8-sig"))
    if not cfg.get("IG_TOKEN") or cfg["IG_TOKEN"].startswith("ВСТАВЬ"):
        sys.exit("В config.json нет токена: вставь IG_TOKEN (см. SETUP.md)")
    return cfg


def get(path, token, **params):
    params["access_token"] = token
    url = path if path.startswith("http") else f"{API}/{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            err = json.loads(body)["error"]
            msg = f"{err.get('type')} {err.get('code')}: {err.get('message')}"
        except Exception:  # noqa: BLE001
            msg = body[:300]
        sys.exit(f"Instagram API ответил ошибкой ({e.code}): {msg}")


def pages(path, token, **params):
    """Iterate every item across paginated responses."""
    data = get(path, token, **params)
    while True:
        yield from data.get("data", [])
        nxt = data.get("paging", {}).get("next")
        if not nxt:
            return
        data = get(nxt, token)  # the next URL already carries the token


def find_ig_user(cfg, token):
    """IG user id for a facebook-host token: config, then linked Pages, then the business portfolio."""
    if cfg.get("IG_USER_ID"):
        return cfg["IG_USER_ID"]
    for page in get("me/accounts", token, fields="instagram_business_account{id,username}").get("data", []):
        acc = page.get("instagram_business_account")
        if acc:
            return acc["id"]
    for acc in get(f"{BUSINESS_ID}/instagram_accounts", token, fields="id,username").get("data", []):
        return acc["id"]
    sys.exit("Не нашёл аккаунт Instagram для этого токена: впиши IG_USER_ID в config.json (см. SETUP.md)")


def write_atomic(path, text):
    """Write through a temp file so a full disk never leaves a truncated file behind."""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def refresh(cfg):
    data = get("refresh_access_token", cfg["IG_TOKEN"], grant_type="ig_refresh_token")
    cfg["IG_TOKEN"] = data["access_token"]
    (HERE / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    days = int(data.get("expires_in", 0)) // 86400
    print(f"✅ Токен продлён, действует ещё ~{days} дн.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--last", type=int, default=0, help="только N последних рилсов")
    ap.add_argument("--refresh", action="store_true", help="продлить токен")
    args = ap.parse_args()

    global API
    cfg = load_config()
    token = cfg["IG_TOKEN"]
    if not token.startswith("IG"):
        API = "https://graph.facebook.com/v23.0"
    if args.refresh:
        if not token.startswith("IG"):
            print("Токен системного пользователя бессрочный — продлевать не нужно.")
            return
        refresh(cfg)
        return

    user = "me" if token.startswith("IG") else find_ig_user(cfg, token)
    me = get(user, token, fields="username,followers_count,media_count")
    own = me.get("username", "").lower()
    print(f"🏝 @{own}: подписчиков {me.get('followers_count', '?')}, публикаций {me.get('media_count', '?')}")

    media = [m for m in pages(f"{user}/media", token, fields="id,caption,media_product_type,timestamp,permalink,comments_count", limit=50)
             if m.get("media_product_type") == "REELS"]
    media.sort(key=lambda m: m["timestamp"])
    if args.last:
        media = media[-args.last:]

    comments = []
    for n, m in enumerate(media, 1):
        got = 0
        for c in pages(f"{m['id']}/comments", token, fields="id,text,username,timestamp", limit=50):
            comments.append({"id": c.get("id"), "reel": m["permalink"], "reel_time": m["timestamp"], "username": (c.get("username") or "").lower(),
                             "text": c.get("text", ""), "time": c["timestamp"]})
            got += 1
        print(f"  рилс {n}: {m['permalink']}  комментов {got} (по счётчику {m.get('comments_count', '?')})")

    # residents: unique commenters by first comment, the account itself excluded; existing numbers are kept
    out = HERE / "residents.json"
    try:
        old = {r["nick"]: r for r in json.loads(out.read_text(encoding="utf-8"))} if out.exists() else {}
    except ValueError:
        # never renumber everyone from scratch: residents' numbers must stay stable
        sys.exit(f"{out.name} повреждён — восстанови его (например, из данных сайта), номера жителей не трогаю")
    residents = dict(old)
    for c in sorted(comments, key=lambda c: c["time"]):
        nick = c["username"]
        if not nick or nick == own or nick in residents:
            continue
        residents[nick] = {"no": len(residents) + 2, "nick": nick, "since": c["time"], "reel": c["reel"]}  # №1 — сам остров
    rows = sorted(residents.values(), key=lambda r: r["no"])
    write_atomic(out, json.dumps(rows, ensure_ascii=False, indent=1))
    write_atomic(HERE / "comments.json", json.dumps(comments, ensure_ascii=False, indent=1))

    new = len(rows) - len(old)
    print(f"\n✅ Жителей: {len(rows) + 1} (новых сегодня: {new}) → residents.json")
    print(f"   Комментов всего: {len(comments)} → comments.json")
    print(f"   Собрано {datetime.now(timezone.utc).astimezone():%d.%m %H:%M}")


if __name__ == "__main__":
    main()
