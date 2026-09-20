"""
Udemy Quiz Scraper — Multi-Course
Discovers ALL enrolled CompTIA / Sec+ courses, scrapes every quiz,
saves to udemy_questions.db (SQLite) + merges into questions.json
"""

import requests, json, sqlite3, re, sys, time

BASE_URL = "https://www.udemy.com"

# ── FRESH COOKIES ─────────────────────────────────────────────────────────────
COOKIES = {
    "access_token":  '"FHWw1mlfFtut4FLhKVlMVSdLSQUY/dW3cz08rrJgnN8:D4pZU4FKOSyq/XwdajtszQXgNifJmB9p4Myh4iAP+Ng"',
    "client_id":     "bd2565cb7b0c313f5e9bae44961e8db2",
    "csrftoken":     "hszkQVFGost9eMK4gqUMCEzIAfgF1a95",
    "ud_user_jwt":   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MzQ0MzM5NzM5LCJlbWFpbCI6Im1vbmVjaWxsaWdhbmRAaG90bWFpbC5jb20iLCJpc19zdXBlcnVzZXIiOmZhbHNlLCJncm91cF9pZHMiOltdfQ.6_2RfECVoIbskBxVTH3lvUjng-mVGPUXABplQOKmczk",
    "dj_session_id": "4q9100ysp1qc7zyoc6qi1a6ordn3hrei",
    "cf_clearance":  "l6RkBsxkMQ7SpLxEUMusP6Qlu5vj2RmEiJZ7op6d_2s-1789638280-1.2.1.1-5jQcvcxJCtLEAUnXrkQ1EF.XzsIbn1AgEnwFaptN9OZtkzdU8KvDAqf1LZI13HRlLJXMuxXucuuQgNifYRfk7L_289wYjGRshoCLTVswsxYL2vaj56.ztj2bveeMyFQIEJVLlQxkWWfSL84rDJkkBv9yyKEyy.qvuziNWLCcnNa4WyL8BU.pziEauRFlbLQBKaA9cBCADTqcGmhEke4j7cNab7VgFdnJHqBXQb_e6YFV8VVMYlYEVUE2f_qFpeKrqjo98Q1P3TkhINes9ACn_yP2pNnh43yf7_tg4lmDnRHA.r0.76lEHzQZDgm64iiy6RanOe.9R2zIsjl4dbxQvaF6.ShT0mhvc57tWVeVjV8",
    "__cf_bm":       "PHafhk3XJBVcWLRkWmz2uVSJvg05sWOjcE3p0zigoHo-1789638280.1796844-1.0.1.1-H6RaTgZZrjwc5FwsGR4oKgEAgEtvinTlyZYWOeqQL.99iNXntM9AfrzBsPKEehSliXLG4uhecPhVWeKvXIg3CzybNRSS5pkekr_.PzXYQeWfnbPu0M3va0cSfcIAWQL4",
    "__udmy_2_v57r": "ff4cf9ef21e947e6adad5b19d418ffe8",
    "ud_locale":     "en_US",
}

HEADERS = {
    "User-Agent":         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Accept":             "application/json, text/plain, */*",
    "Accept-Language":    "en-US,en;q=0.9",
    "Referer":            "https://www.udemy.com/home/my-courses/",
    "X-Requested-With":   "XMLHttpRequest",
    "X-Udemy-Snail-Case": "true",
}

# Keywords to filter for CompTIA / Security+ courses (leave empty = crawl ALL)
KEYWORDS = ["security", "comptia", "sec+", "sy0", "network+", "cysa", "casp", "pentest"]

session = requests.Session()
session.cookies.update(COOKIES)
session.headers.update(HEADERS)


# ── helpers ───────────────────────────────────────────────────────────────────
def clean(s):
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", "", str(s))
    return s.strip()

def safe_get(url, label=""):
    try:
        r = session.get(url, timeout=25)
        if r.status_code == 200:
            return r.json()
        print(f"  [!] {label} -> HTTP {r.status_code}")
        return None
    except Exception as e:
        print(f"  [!] {label} -> {e}")
        return None


# ── STEP 1: get all enrolled courses ─────────────────────────────────────────
def get_enrolled_courses():
    print("[*] Discovering enrolled courses...")
    courses = []
    page = 1
    while True:
        url = (
            f"{BASE_URL}/api-2.0/users/me/subscribed-courses/"
            f"?ordering=-last_accessed&fields[course]=id,title,url,num_quizzes"
            f"&page_size=100&page={page}"
        )
        data = safe_get(url, "subscribed-courses")
        if not data:
            break
        for c in data.get("results", []):
            title_low = c.get("title", "").lower()
            # filter by keyword OR take all if KEYWORDS is empty
            if not KEYWORDS or any(k in title_low for k in KEYWORDS):
                courses.append({
                    "id":     c["id"],
                    "title":  c.get("title", "?"),
                    "quizzes": c.get("num_quizzes", 0),
                })
        if not data.get("next"):
            break
        page += 1

    print(f"[+] Matched {len(courses)} course(s):")
    for c in courses:
        print(f"    [{c['id']}] {c['title']}  ({c['quizzes']} quizzes)")
    return courses


# ── STEP 2: curriculum quizzes for one course ─────────────────────────────────
def get_quizzes(course_id):
    quizzes = []
    page = 1
    while True:
        url = (
            f"{BASE_URL}/api-2.0/courses/{course_id}/subscriber-curriculum-items/"
            f"?page_size=200&page={page}"
            f"&fields[quiz]=id,title,num_assessments,is_published"
            f"&fields[chapter]=id,title"
            f"&fields[lecture]=id"
        )
        data = safe_get(url, f"curriculum-{course_id}")
        if not data:
            break
        for item in data.get("results", []):
            if item.get("_class") == "quiz":
                quizzes.append({
                    "id":    item["id"],
                    "title": item.get("title", "Quiz"),
                    "count": item.get("num_assessments", 0),
                })
        if not data.get("next"):
            break
        page += 1
    return quizzes


# ── STEP 3: questions for one quiz ───────────────────────────────────────────
def get_questions(quiz, course_title):
    qid   = quiz["id"]
    title = quiz["title"]
    url   = (
        f"{BASE_URL}/api-2.0/quizzes/{qid}/assessments/"
        f"?page_size=250"
        f"&fields[assessment]=id,prompt,correct_response,section,explanation"
    )
    data = safe_get(url, f"quiz-{qid}")
    if not data:
        return []

    parsed = []
    for item in data.get("results", []):
        prompt  = item.get("prompt", {})
        q_text  = clean(prompt.get("question", ""))
        answers = [clean(a) for a in prompt.get("answers", [])]

        # correct index
        correct_raw = item.get("correct_response", [])
        correct_idx = []
        for c in correct_raw:
            if isinstance(c, int):
                correct_idx.append(c)
            elif isinstance(c, str):
                try:
                    correct_idx.append(int(c))
                except ValueError:
                    if c in answers:
                        correct_idx.append(answers.index(c))
                    elif clean(c) in answers:
                        correct_idx.append(answers.index(clean(c)))

        # explanation
        exp_raw = item.get("explanation", {})
        if isinstance(exp_raw, dict):
            explanation = clean(exp_raw.get("body") or exp_raw.get("text", ""))
        else:
            explanation = clean(exp_raw)

        if not q_text or not answers:
            continue

        parsed.append({
            "quiz_id":      qid,
            "quiz_title":   title,
            "course_title": course_title,
            "question":     q_text,
            "options":      answers,
            "correct":      correct_idx[0] if len(correct_idx) == 1 else (correct_idx or [0]),
            "multi":        len(correct_idx) > 1,
            "explanation":  explanation,
        })
    return parsed


# ── STEP 4: save to SQLite ────────────────────────────────────────────────────
def save_db(all_q, path="udemy_questions.db"):
    conn = sqlite3.connect(path)
    cur  = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS questions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            quiz_id       INTEGER,
            quiz_title    TEXT,
            course_title  TEXT,
            question      TEXT NOT NULL,
            options       TEXT,
            correct       TEXT,
            multi         INTEGER DEFAULT 0,
            explanation   TEXT,
            UNIQUE(question, quiz_id)
        )
    """)
    added = 0
    for q in all_q:
        try:
            cur.execute("""
                INSERT OR IGNORE INTO questions
                  (quiz_id, quiz_title, course_title, question, options, correct, multi, explanation)
                VALUES (?,?,?,?,?,?,?,?)
            """, (
                q["quiz_id"], q["quiz_title"], q["course_title"],
                q["question"],
                json.dumps(q["options"],  ensure_ascii=False),
                json.dumps(q["correct"],  ensure_ascii=False),
                int(q["multi"]), q["explanation"],
            ))
            added += cur.rowcount
        except Exception as e:
            pass
    conn.commit()
    total = cur.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    conn.close()
    print(f"[+] DB: +{added} new rows | total in DB: {total}  -> {path}")


# ── STEP 5: merge into questions.json (app format) ───────────────────────────
DOMAIN_MAP = {
    "general":        1, "concept":      1, "cia":           1,
    "threat":         2, "vulnerabilit": 2, "attack":        2, "malware": 2,
    "architecture":   3, "network":      3, "infrastructure":3,
    "implementation": 4, "cryptograph":  4, "pki":           4, "protocol": 4,
    "governance":     5, "compliance":   5, "risk":          5,
    "incident":       5, "operation":    5, "forensic":      5,
}

def to_domain(quiz_title):
    t = quiz_title.lower()
    for kw, d in DOMAIN_MAP.items():
        if kw in t:
            return d
    return 1

def merge_into_app(all_q, app_path="questions.json"):
    with open(app_path, encoding="utf-8") as f:
        existing = json.load(f)

    seen   = set(q["q"] for q in existing)
    before = len(existing)

    for q in all_q:
        if q["question"] in seen:
            continue
        c = q["correct"]
        if isinstance(c, list):
            c = c[0] if c else 0
        existing.append({
            "d": to_domain(q["quiz_title"]),
            "q": q["question"],
            "o": q["options"],
            "a": c,
            "e": q["explanation"],
        })
        seen.add(q["question"])

    with open(app_path, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)

    added = len(existing) - before
    print(f"[+] questions.json: +{added} new | total: {len(existing)}")
    return len(existing)


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    courses = get_enrolled_courses()
    if not courses:
        print("[!] No matching courses found. Check keywords or cookies.")
        sys.exit(1)

    all_questions = []

    for course in courses:
        cid   = course["id"]
        ctitle = course["title"]
        print(f"\n[Course] {ctitle}")

        quizzes = get_quizzes(cid)
        if not quizzes:
            print("  (no quizzes found)")
            continue

        for quiz in quizzes:
            print(f"  [Quiz] {quiz['title']}  ({quiz['count']} items)")
            qs = get_questions(quiz, ctitle)
            print(f"    -> {len(qs)} parsed")
            all_questions.extend(qs)
            time.sleep(0.3)   # polite delay

    if not all_questions:
        print("\n[!] Nothing scraped. Session likely expired.")
        sys.exit(1)

    print(f"\n[=] Grand total scraped this run: {len(all_questions)}")

    # persist
    save_db(all_questions)

    # raw JSON backup
    with open("udemy_questions_raw.json", "w", encoding="utf-8") as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)
    print("[+] Raw dump -> udemy_questions_raw.json")

    total = merge_into_app(all_questions)

    # update pill in index.html
    html = open("index.html", encoding="utf-8").read()
    html = re.sub(r'\d+-question bank', f'{total}-question bank', html)
    open("index.html", "w", encoding="utf-8").write(html)
    print(f"[+] index.html pill updated -> {total}-question bank")
    print("\n[DONE] Open index.html to study!")

if __name__ == "__main__":
    main()
