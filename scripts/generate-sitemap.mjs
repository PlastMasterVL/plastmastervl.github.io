// Генерирует public/sitemap.xml перед сборкой сайта.
// Подтягивает список всех товаров из Supabase, чтобы у каждого
// была своя строка в карте сайта — это помогает поисковикам находить
// не только главную страницу, но и отдельные товары.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const SUPABASE_URL = "https://cmbcgebjssfzevxohrtl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g9MY0VJFrYsbrMy8SE0hMw_GV9EnHnf";
const SITE_URL = "https://plastmastervl.github.io";

const STATIC_PAGES = ["", "catalog", "promos", "news", "reviews", "contacts", "custom", "privacy"];

async function generate() {
  let products = [];
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const { data, error } = await supabase.from("products").select("id, created_at");
    if (error) throw error;
    products = data || [];
  } catch (e) {
    console.warn("Не удалось получить список товаров для sitemap — публикуем без них:", e.message);
  }

  const urls = [
    ...STATIC_PAGES.map((p) => ({ loc: `${SITE_URL}/${p}`.replace(/\/$/, "") || SITE_URL, priority: p === "" ? "1.0" : "0.7" })),
    ...products.map((p) => ({ loc: `${SITE_URL}/product/${p.id}`, priority: "0.8", lastmod: p.created_at?.slice(0, 10) })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ""}    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;

  writeFileSync("public/sitemap.xml", xml);
  console.log(`sitemap.xml создан: ${urls.length} адресов (${products.length} товаров).`);
}

generate();
