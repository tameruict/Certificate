import requests, json

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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.udemy.com/course/securityplus/learn/",
}
s = requests.Session()
s.cookies.update(COOKIES)
s.headers.update(HEADERS)

# Step 1: course info
r = s.get("https://www.udemy.com/api-2.0/courses/securityplus/?fields[course]=id,title,num_quizzes,num_lectures", timeout=15)
print("=== COURSE ===", r.status_code)
try:
    d = r.json()
    print(f"ID={d.get('id')}  title={d.get('title')}  quizzes={d.get('num_quizzes')}  lectures={d.get('num_lectures')}")
    COURSE_ID = d.get("id")
except:
    print(r.text[:300])
    COURSE_ID = None

if COURSE_ID:
    # Step 2: curriculum - all pages
    print("\n=== CURRICULUM ===")
    page = 1
    quiz_count = 0
    while True:
        r2 = s.get(
            f"https://www.udemy.com/api-2.0/courses/{COURSE_ID}/subscriber-curriculum-items/"
            f"?page_size=200&page={page}&fields[quiz]=id,title,num_assessments&fields[chapter]=id,title",
            timeout=15
        )
        print(f"  Page {page}: {r2.status_code}")
        if r2.status_code != 200:
            print("  Body:", r2.text[:200])
            break
        d2 = r2.json()
        for item in d2.get("results", []):
            cls = item.get("_class")
            if cls == "quiz":
                print(f"    [QUIZ] id={item['id']}  title={item.get('title')}  count={item.get('num_assessments')}")
                quiz_count += 1
            elif cls == "chapter":
                print(f"    [CH]   {item.get('title')}")
        if not d2.get("next"):
            break
        page += 1
    print(f"\nTotal quizzes found: {quiz_count}")
