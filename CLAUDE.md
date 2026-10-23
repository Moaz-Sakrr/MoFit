# MoFit: دليل المشروع لـ Claude Code

منصة تدريب أونلاين. موقع ثابت (HTML وCSS وES modules) على Supabase، منشور على Cloudflare static assets.

## قبل ما تبدأ أي شغل
- شغّل `git status` و`git branch --show-current` و`git log --oneline -10`. فيه أكتر من واحد بيشتغل على الـ repo، فمتفترضش إن الملفات زي ما سبتها.
- متشتغلش على `main` مباشرة. كل feature على branch باسمها (`feature/...`).
- ممنوع `git push` أو `git reset --hard` أو `--force` أو حذف branches من غير ما المستخدم يطلب صراحة.
- الـ commits من غير سطر `Co-Authored-By: Claude`.
- اقرا الـ diff (`git diff`) قبل أي commit، ولا تلمس ملفات برّه المطلوب.

## البنية
- مفيش build ولا package.json. شغّل محلياً بـ `python -m http.server 8000`.
- `app.html` هو هيكل التطبيق، و`js/app.js` فيه الـ router (hash). كل صفحة موديول في `js/views/*.js` بيصدّر `renderX(main, ctx)`. تضيف صفحة جديدة في 4 أماكن: import في `app.js`، وفرع في `route()`، ورابط `<a data-view>` في `app.html`، وصلاحية الوصول.
- بعد أي `await` في الـ view اتأكد من `ctx.stale()` عشان ما ترسمش فوق صفحة المتدرب بعد ما يروح لصفحة تانية.
- أدوات جاهزة: `js/ui.js` (`toast`, `openSheet`, `confirmSheet`, `loadingView`)، `js/youtube.js` (`youtubeId`, `thumbnail`, `openVideo`)، و`esc()` من `js/supabase.js`. استخدمها بدل ما تكتب بديل.
- الواجهة كلها عربي (لهجة مصرية) واتجاهها RTL. النصوص مكتوبة جوه الكود مفيش i18n.

## قيود الـ CSP (في `_headers`)
- مفيش inline `<script>` ولا `style="..."` ولا مكتبات من CDN. السكريبتات من `'self'` بس.
- الرسومات (زي الشارت) بتتعمل بـ SVG بـ attributes وclasses في `css/app.css`.
- الاتصال بـ Supabase بس. لو احتجت دومين تاني لازم يتضاف في `_headers`.

## قاعدة البيانات
- الملف الوحيد هو `supabase/schema.sql`. idempotent (`if not exists` / `drop policy if exists`) ويتشغّل يدوياً في SQL Editor. مفيش migrations.
- كل feature تضيف قسم جديد برقم (`-- 7.10`, `-- 7.11`…) قبل `-- 8)`. اتفقوا على الأرقام عشان ما تتعارضش.
- كل جدول جديد لازم: RLS مفعّل، وسياسات صريحة (القراءة لصاحب الصف والكوتش، الكتابة حسب الدور). والجداول الخاصة بالمتدرب فيها `member_id uuid references profiles(id) on delete cascade`.
- أضف الجدول الجديد لقائمة `.github/scripts/health-check.sh` (فحص إن الزائر ما يشوفش بيانات خاصة).
- اختبار الصلاحيات: `supabase/tests/workout_rls.sql` (جوه transaction وبينتهي بـ rollback). اعمل ملف زيه لأي feature فيها صلاحيات.
- التغييرات على قاعدة البيانات الحقيقية بتتطبّق بعد ما الـ PR يندمج، وواحد بس بيطبّقها. جرّب الأول على مشروع Supabase تجريبي.

## ملفات ممنوع تتعمل لها commit
- أي مفتاح `service_role` أو كلمة سر أو `.env`. مفتاح `anon` في `js/config.js` آمن بس.
- لو بتجرّب على مشروع Supabase تاني، غيّر `js/config.js` محلياً ومتعملوش commit للتغيير ده.

## ملفات بتتعارض كتير بين اتنين شغالين
`supabase/schema.sql` و`js/app.js` و`app.html` و`css/app.css` و`sw.js` (رقم `CACHE`). اعمل `git pull` / merge لـ main بدري، وبلّغ التاني قبل ما تعدّل فيهم.
