"""Which countries and regions people ask for in comments: counts only, no nicks (printed to the Actions log).

usage: python tools/country_scan.py   (after fetch_comments.py)
"""
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent

PLACES = {
    "Кыргызстан": ["кыргыз", "киргиз", "kyrgyz", "🇰🇬"], "Казахстан": ["казах", "kazakh", "🇰🇿"],
    "Узбекистан": ["узбек", "uzbek", "🇺🇿"], "Таджикистан": ["таджик", "tajik", "🇹🇯"],
    "Россия": ["росси", "russia", "🇷🇺"], "Азербайджан": ["азер", "azer", "🇦🇿"],
    "Туркменистан": ["туркмен", "turkmen", "🇹🇲"], "Турция": ["турци", "turkiye", "turkey", "🇹🇷"],
    "Беларусь": ["беларус", "белорус", "belarus", "🇧🇾"], "Украина": ["украин", "ukrain", "🇺🇦"],
    "Армения": ["армени", "armeni", "🇦🇲"], "Грузия": ["грузи", "georgia", "🇬🇪"],
    "Монголия": ["монгол", "mongol", "🇲🇳"], "Афганистан": ["афган", "afghan", "🇦🇫"],
    "Пакистан": ["пакистан", "pakistan", "🇵🇰"], "Индия": ["индия", "индию", "индии", "india", "🇮🇳"],
    "Иран": ["иран", "iran", "🇮🇷"], "Молдова": ["молдов", "молдав", "moldov", "🇲🇩"],
    "Германия": ["германи", "germany", "🇩🇪"], "США": ["сша", "америк", "usa", "🇺🇸"],
    "Китай": ["китай", "china", "🇨🇳"], "Корея": ["корея", "корей", "korea", "🇰🇷"],
    "Египет": ["египет", "egypt", "🇪🇬"], "Саудовская Аравия": ["саудов", "saudi", "🇸🇦"],
    "ОАЭ": ["оаэ", "эмират", "dubai", "дубай", "🇦🇪"], "Израиль": ["израил", "israel", "🇮🇱"],
    "Палестина": ["палестин", "palestin", "🇵🇸"], "Сербия": ["серби", "serbia", "🇷🇸"],
    "Польша": ["польш", "poland", "🇵🇱"], "Франция": ["франци", "france", "🇫🇷"],
    "Бразилия": ["бразили", "brazil", "🇧🇷"], "Португалия": ["португали", "portugal", "🇵🇹"],
    "Испания": ["испани", "spain", "🇪🇸"], "Италия": ["итали", "italy", "🇮🇹"],
    "Чечня": ["чечн", "чечен", "нохчи"], "Дагестан": ["дагестан", "даг "], "Татарстан": ["татар"],
    "Башкортостан": ["башкир", "башкорт"], "Якутия": ["якут", "саха"], "Бурятия": ["бурят"],
    "Каракалпакстан": ["каракалпак"], "Ингушетия": ["ингуш"], "Осетия": ["осети"], "Кавказ": ["кавказ"],
    "Памир": ["памир"], "Таджикистан/Бадахшан": ["бадахшан"],
}

comments = json.loads((HERE / "comments.json").read_text(encoding="utf-8"))
since = sys.argv[1] if len(sys.argv) > 1 else ""
cnt, people = {}, {}
for c in comments:
    if c.get("time", "") < since:
        continue
    t = c.get("text", "").lower().replace("ё", "е")
    words = re.findall(r"[a-zа-я]+", t)
    for name, keys in PLACES.items():
        # a word must start with the key («грузи» must not hit «загрузи»); emoji flags match anywhere
        if any((k in t) if not k[0].isalpha() else any(w.startswith(k.strip()) for w in words) for k in keys):
            cnt[name] = cnt.get(name, 0) + 1
            people.setdefault(name, set()).add(c.get("username", ""))
# flag emojis: comments that are only flags, and every flag emoji counted one by one
FLAGS = {"Кыргызстан": "🇰🇬", "Казахстан": "🇰🇿", "Узбекистан": "🇺🇿", "Таджикистан": "🇹🇯", "Россия": "🇷🇺", "Азербайджан": "🇦🇿"}
print("Флаги-эмодзи: комментов с флагом / только флаги без слов / всего флажков:")
for name, fl in FLAGS.items():
    with_flag = [c.get("text", "") for c in comments if fl in c.get("text", "")]
    only = sum(1 for t in with_flag if not re.search(r"[a-zа-яё]", t.lower()))
    total = sum(t.count(fl) for t in with_flag)
    print(f"  {name}: {len(with_flag)} / {only} / {total}")
print(f"Страны в комментах (всего комментов {len(comments)}):")
for name, n in sorted(cnt.items(), key=lambda kv: -kv[1]):
    print(f"  {name}: {n} комментов, {len(people[name])} человек")
