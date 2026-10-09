#!/usr/bin/env bash
# فحص إن الموقع شغال: الصفحات، و Supabase (الدخول وقاعدة البيانات)، وإن مفيش بيانات خاصة باينة لأي حد من بره
# بيقرا رابط Supabase والمفتاح العام من js/config.js (نفس اللي في الموقع، مش سر)
# التشغيل: bash .github/scripts/health-check.sh   (من فولدر المشروع)
set -u

SITE_URL="${SITE_URL:-https://mofit.mofit233.workers.dev}"
CONFIG="${CONFIG:-js/config.js}"
SB_URL=$(sed -n 's/.*SUPABASE_URL = "\([^"]*\)".*/\1/p' "$CONFIG")
SB_KEY=$(sed -n 's/.*SUPABASE_ANON_KEY = "\([^"]*\)".*/\1/p' "$CONFIG")
[ -n "$SB_URL" ] && [ -n "$SB_KEY" ] || { echo "مش لاقي SUPABASE_URL أو SUPABASE_ANON_KEY في $CONFIG"; exit 1; }

failed=0
pass() { echo "OK    $1"; }
fail() { echo "FAIL  $1"; failed=1; }

# بيرجّع "كود الحالة|الرد"، وبيعيد المحاولة لو في مشكلة شبكة مؤقتة
get() {
  local body code
  body=$(curl -sS -L --max-time 20 --retry 3 --retry-delay 5 --retry-all-errors \
    -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" -w $'\n%{http_code}' "$1" 2>&1) || true
  code=${body##*$'\n'}
  printf '%s|%s' "$code" "${body%$'\n'*}"
}

# 1) صفحات الموقع
for page in "/" "/login.html" "/app.html"; do
  r=$(get "$SITE_URL$page"); code=${r%%|*}; body=${r#*|}
  if [ "$code" = 200 ] && grep -q "MoFit" <<<"$body"; then pass "الموقع $page"; else fail "الموقع $page (كود $code)"; fi
done

# 2) خدمة تسجيل الدخول
r=$(get "$SB_URL/auth/v1/health"); code=${r%%|*}
[ "$code" = 200 ] && pass "Supabase Auth" || fail "Supabase Auth (كود $code)"

# 3) قاعدة البيانات: نتايج المشتركين متاحة للكل، فلازم الطلب ينجح ويرجّع list
#    (الطلب ده كمان بيخلي مشروع Supabase المجاني نشط وما يتوقفش)
r=$(get "$SB_URL/rest/v1/results?select=id&limit=1"); code=${r%%|*}; body=${r#*|}
if [ "$code" = 200 ] && [ "${body:0:1}" = "[" ]; then pass "قاعدة البيانات"; else fail "قاعدة البيانات (كود $code)"; fi

# 4) الأمان: زائر من غير حساب ما ينفعش يشوف أي بيانات خاصة (لازم الرد يبقى [] فاضي)
for table in profiles exercises programs progress_photos; do
  r=$(get "$SB_URL/rest/v1/$table?select=*&limit=1"); code=${r%%|*}; body=${r#*|}
  if [ "$code" = 200 ] && [ "$body" = "[]" ]; then pass "حماية $table"
  elif [ "$code" = 200 ]; then fail "حماية $table: في بيانات خاصة باينة لأي حد! راجع RLS في Supabase"
  else fail "حماية $table (كود $code)"; fi
done

r=$(curl -sS --max-time 20 --retry 3 --retry-all-errors -X POST -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
  -H "Content-Type: application/json" -d '{"prefix":"","limit":1}' -w $'\n%{http_code}' "$SB_URL/storage/v1/object/list/progress-photos" 2>&1) || true
code=${r##*$'\n'}; body=${r%$'\n'*}
if [ "$code" = 200 ] && [ "$body" = "[]" ]; then pass "حماية صور المتابعة"
elif [ "$code" = 200 ]; then fail "حماية صور المتابعة: الصور باينة لأي حد! راجع سياسات Storage"
else fail "حماية صور المتابعة (كود $code)"; fi

echo
[ "$failed" = 0 ] && echo "كله تمام" || echo "في مشكلة: راجع السطور اللي فيها FAIL"
exit "$failed"
