"""
Udemy Scraper — securityplus (ID 2015076)
CompTIA Security+ (SY0-701) Complete Course & Practice Exam
28 quizzes accessible -> scrape all -> merge into questions.json
"""

import requests, json, sqlite3, re, time

BASE_URL    = "https://www.udemy.com"
COURSE_ID   = 2015076
COURSE_SLUG = "securityplus"

COOKIES = {
    "access_token":  '"FHWw1mlfFtut4FLhKVlMVSdLSQUY/dW3cz08rrJgnN8:D4pZU4FKOSyq/XwdajtszQXgNifJmB9p4Myh4iAP+Ng"',
    "client_id":     "bd2565cb7b0c313f5e9bae44961e8db2",
    "csrftoken":     "hszkQVFGost9eMK4gqUMCEzIAfgF1a95",
    "ud_user_jwt":   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MzQ0MzM5NzM5LCJlbWFpbCI6Im1vbmVjaWxsaWdhbmRAaG90bWFpbC5jb20iLCJpc19zdXBlcnVzZXIiOmZhbHNlLCJncm91cF9pZHMiOltdfQ.6_2RfECVoIbskBxVTH3lvUjng-mVGPUXABplQOKmczk",
    "dj_session_id": "4q9100ysp1qc7zyoc6qi1a6ordn3hrei",
    "cf_clearance":  "l6RkBsxkMQ7SpLxEUMusP6Qlu5vj2RmEiJZ7op6d_2s-1789638280-1.2.1.1-5jQcvcxJCtLEAUnXrkQ1EF.XzsIbn1AgEnwFaptN9OZtkzdU8KvDAqf1LZI13HRlLJXMuxXucuuQgNifYRfk7L_289wYjGRshoCLTVswsxYL2vaj56.ztj2bveeMyFQIEJVLlQxkWWfSL84rDJkkBv9yyKEyy.qvuziNWLCcnNa4WyL8BU.pziEauRFlbLQBKaA9cBCADTqcGmhEke4j7cNab7VgFdnJHqBXQb_e6YFV8VVMYlYEVUE2f_qFpeKrqjo98Q1P3TkhINes9ACn_yP2pNnh43yf7_tg4lmDnRHA.r0.76lEHzQZDgm64iiy6RanOe.9R2zIsjl4dbxQvaF6.ShT0mhvc57tWVeVjV8",
    "__cf_bm":       "PHafhk3XJBVcWLRkWmz2uVSJvg05sWOjcE3p0zigoHo-1789638280.1796844-1.0.1.1-H6RaTgZZrjwc5FwsGR4oKgEAgEtvinTlyZYWOeqQL.99iNXntM9AfrzBsPKEehSliXLG4uhecPhVWeKvXIg3CzybNRSS5pkekr_.PzXYQeWfnbPu0M3va0cSfcIAWQL4",
}
HEADERS = {
    "User-Agent":         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Accept":             "application/json, text/plain, */*",
    "X-Requested-With":   "XMLHttpRequest",
    "Referer":            f"https://www.udemy.com/course/{COURSE_SLUG}/learn/",
    "X-Udemy-Snail-Case": "true",
}

session = requests.Session()
session.cookies.update(COOKIES)
session.headers.update(HEADERS)

# Chapter -> domain mapping for SY0-701
CHAPTER_DOMAIN = {
    "introduction":          1,
    "fundamentals":          1,
    "threat actors":         2,
    "physical security":     1,
    "social engineering":    2,
    "malware":               2,
    "data protection":       4,
    "cryptographic":         4,
    "risk management":       5,
    "third-party":           5,
    "governance":            5,
    "compliance":            5,
    "asset":                 5,
    "change management":     5,
    "audits":                5,
    "assessments":           5,
    "cyber resilience":      3,
    "redundancy":            3,
    "security architecture": 3,
    "security infrastructure":3,
    "identity and access":   4,
    "iam":                   4,
    "vulnerabilities":       2,
    "attacks":               2,
    "malicious activity":    2,
    "hardening":             4,
    "security techniques":   4,
    "vulnerability management":5,
    "alerting":              5,
    "monitoring":            5,
    "incident response":     5,
    "investigating":         5,
    "automation":            4,
    "orchestration":         4,
    "security awareness":    5,
    "practice exam":         1,
}

def chapter_to_domain(chapter_title):
    t = chapter_title.lower()
    for kw, d in CHAPTER_DOMAIN.items():
        if kw in t:
            return d
    return 1

def clean(s):
    if not s:
        return ""
    return re.sub(r"<[^>]+>", "", str(s)).strip()

def get_curriculum():
    print("[*] Fetching curriculum...")
    quizzes = []
    current_chapter = "General"
    page = 1
    while True:
        url = (
            f"{BASE_URL}/api-2.0/courses/{COURSE_ID}/subscriber-curriculum-items/"
            f"?page_size=200&page={page}"
            f"&fields[quiz]=id,title,num_assessments,is_published"
            f"&fields[chapter]=id,title"
            f"&fields[lecture]=id"
        )
        r = session.get(url, timeout=20)
        if r.status_code != 200:
            print(f"  Curriculum page {page}: {r.status_code}")
            break
        data = r.json()
        for item in data.get("results", []):
            cls = item.get("_class")
            if cls == "chapter":
                current_chapter = item.get("title", "General")
            elif cls == "quiz":
                quizzes.append({
                    "id":      item["id"],
                    "title":   item.get("title", "Quiz"),
                    "count":   item.get("num_assessments", 0),
                    "chapter": current_chapter,
                    "domain":  chapter_to_domain(current_chapter),
                })
        if not data.get("next"):
            break
        page += 1

    print(f"[+] Found {len(quizzes)} quizzes")
    for q in quizzes:
        print(f"    [D{q['domain']}] {q['title']} ({q['count']} qs) — {q['chapter']}")
    return quizzes

def get_questions(quiz):
    qid   = quiz["id"]
    title = quiz["title"]
    url   = (
        f"{BASE_URL}/api-2.0/quizzes/{qid}/assessments/"
        f"?page_size=250"
        f"&fields[assessment]=id,prompt,correct_response,section,explanation"
    )
    r = session.get(url, timeout=25)
    if r.status_code != 200:
        print(f"    [!] Quiz {qid} -> {r.status_code}")
        return []

    parsed = []
    for item in r.json().get("results", []):
        prompt  = item.get("prompt", {})
        q_text  = clean(prompt.get("question", ""))
        answers = [clean(a) for a in prompt.get("answers", [])]
        if not q_text or not answers:
            continue

        correct_raw = item.get("correct_response", [])
        correct_idx = []
        for c in correct_raw:
            if isinstance(c, int):
                correct_idx.append(c)
            elif isinstance(c, str):
                try:
                    correct_idx.append(int(c))
                except ValueError:
                    cx = clean(c)
                    if cx in answers:
                        correct_idx.append(answers.index(cx))

        exp_raw = item.get("explanation", {})
        explanation = clean(exp_raw.get("body") or exp_raw.get("text", "") if isinstance(exp_raw, dict) else exp_raw)

        c = correct_idx[0] if len(correct_idx) == 1 else (correct_idx or [0])
        parsed.append({
            "quiz_id":      qid,
            "quiz_title":   title,
            "course_title": "CompTIA Security+ (SY0-701) Complete Course",
            "question":     q_text,
            "options":      answers,
            "correct":      c,
            "multi":        isinstance(c, list),
            "explanation":  explanation,
            "domain":       quiz["domain"],
        })
    return parsed

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
        except:
            pass
    conn.commit()
    total = cur.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    conn.close()
    print(f"[+] DB: +{added} new | total: {total}")

def merge_app(all_q, app_path="questions.json"):
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
            "d": q["domain"],
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

def main():
    print(f"[*] Course: CompTIA Security+ Complete Course (ID {COURSE_ID})")
    quizzes = get_curriculum()
    if not quizzes:
        print("[!] No quizzes.")
        return

    all_questions = []
    for quiz in quizzes:
        print(f"\n  Scraping: [{quiz['id']}] {quiz['title']}")
        qs = get_questions(quiz)
        print(f"    -> {len(qs)} questions")
        all_questions.extend(qs)
        time.sleep(0.3)

    print(f"\n[=] Total scraped: {len(all_questions)}")

    save_db(all_questions)

    with open("securityplus_raw.json", "w", encoding="utf-8") as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)
    print("[+] Raw -> securityplus_raw.json")

    total = merge_app(all_questions)

    # update index.html pill
    html = open("index.html", encoding="utf-8").read()
    html = re.sub(r"\d+-question bank", f"{total}-question bank", html)
    open("index.html", "w", encoding="utf-8").write(html)
    print(f"[+] index.html updated -> {total}-question bank")
    print("\n[DONE]")

if __name__ == "__main__":
    main()
