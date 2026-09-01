import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import { Search, ShoppingCart, User, Heart, Menu, X, Plus, Minus, Trash2, Star, ChevronLeft, ChevronRight, Send, Phone, MapPin, Clock, Package, CheckCircle2, Circle, ArrowRight, Camera, Sparkles, Home as HomeIcon, Grid3x3, Settings, Newspaper, Tag, LayoutDashboard, Users, MessageSquare, Edit2, Trash, Image as ImageIcon, Video, Upload, LogOut, ChevronDown, Filter, SlidersHorizontal, Instagram, Send as TelegramIcon, Sun, Moon, Percent } from "lucide-react";
import { supabase } from "./supabaseClient";

/* =========================================================
   СПРАВОЧНИКИ
   ========================================================= */

// Категории теперь хранятся в базе данных (таблица categories) и управляются из админки
const STATUS_FLOW = ["new", "confirmed", "in_production", "ready", "shipped", "received"];
const STATUS_LABELS = {
  new: { label: "Ожидает подтверждения", emoji: "🟡", color: "#C77B4A" },
  confirmed: { label: "Подтверждён", emoji: "🔵", color: "#5B8AA6" },
  in_production: { label: "В изготовлении", emoji: "🟠", color: "#D08A3E" },
  ready: { label: "Готов", emoji: "🟢", color: "#6E9E71" },
  shipped: { label: "Отправлен", emoji: "📦", color: "#8B9A8C" },
  received: { label: "Получен", emoji: "✅", color: "#4C7A50" },
  cancelled: { label: "Отменён", emoji: "❌", color: "#B5504B" },
};

const ADMIN_EMAILS = ["mamaevv35@gmail.com"]; // почта владельца мастерской PlastMaster

/* =========================================================
   УТИЛИТЫ
   ========================================================= */

const PLACEHOLDER_IMG = (seed, w = 600, h = 600, bg = "E8E1D4", fg = "8B9A8C") =>
  `https://placehold.co/${w}x${h}/${bg}/${fg}?text=${encodeURIComponent(seed)}`;

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatPrice(n) {
  return (n || 0).toLocaleString("ru-RU") + " ₽";
}

function formatDate(d) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

function salePrice(p) {
  if (!p.sale) return p.price;
  return Math.round(p.price * (1 - p.sale / 100));
}

// Преобразование строки из БД (snake_case) в формат, который использует UI (camelCase)
function mapProductFromDb(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    sale: row.sale,
    inStock: row.in_stock,
    qty: row.qty,
    isNew: row.is_new,
    images: row.images && row.images.length ? row.images : [`https://placehold.co/600x600/E8E1D4/8B9A8C?text=${encodeURIComponent(row.name || "Товар")}`],
    video: row.video,
    description: row.description,
    sizes: row.sizes,
    material: row.material,
    colors: row.colors || [],
    craftTime: row.craft_time,
    rating: Number(row.rating) || 0,
    reviewsCount: row.reviews_count || 0,
  };
}

function mapProductToDb(p) {
  return {
    name: p.name, category: p.category, price: p.price, sale: p.sale,
    in_stock: p.inStock, qty: p.qty, is_new: p.isNew, images: p.images,
    video: p.video, description: p.description, sizes: p.sizes,
    material: p.material, colors: p.colors, craft_time: p.craftTime,
  };
}

function mapOrderFromDb(row) {
  return {
    id: row.id, number: row.number, userId: row.user_id,
    customerName: row.customer_name, phone: row.phone, address: row.address,
    city: row.city, zip: row.zip, comment: row.comment,
    items: row.items, total: row.total, status: row.status, date: row.created_at,
    promoCode: row.promo_code, discountAmount: row.discount_amount,
  };
}

function mapReviewFromDb(row) {
  return {
    id: row.id, productId: row.product_id, userName: row.user_name,
    rating: row.rating, text: row.text, photo: row.photo,
    date: row.created_at, approved: row.approved,
  };
}

/* =========================================================
   КОНТЕКСТ ПРИЛОЖЕНИЯ
   ========================================================= */

const ShopContext = createContext(null);
const useShop = () => useContext(ShopContext);

const ThemeContext = createContext(null);
const useTheme = () => useContext(ThemeContext);

function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("sloy_theme");
      if (saved) return saved === "dark";
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (e) { return false; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("sloy_theme", dark ? "dark" : "light"); } catch (e) { /* ignore */ }
  }, [dark]);

  return <ThemeContext.Provider value={{ dark, toggleTheme: () => setDark((d) => !d) }}>{children}</ThemeContext.Provider>;
}

function ShopProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [products, setProducts] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [news, setNews] = useState([]);
  const [promos, setPromos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [heroSlides, setHeroSlides] = useState([]);
  const [allHeroSlides, setAllHeroSlides] = useState([]);
  const [promoCodes, setPromoCodes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]); // упрощённый список для админки (только свои профили не покажет — см. ограничение ниже)
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [cart, setCart] = useState([]); // хранится локально в браузере (localStorage), не в базе
  const [favorites, setFavorites] = useState([]);
  const [customRequests, setCustomRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [toast, setToast] = useState(null);

  const isAdmin = !!session && ADMIN_EMAILS.includes(session.user?.email);
  const currentUser = session ? { id: session.user.id, email: session.user.email, ...profile } : null;

  const showToast = useCallback((text) => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 2600);
  }, []);

  // --- Корзина/избранное храним в localStorage (специфично для устройства) ---
  useEffect(() => {
    try {
      const c = localStorage.getItem("sloy_cart");
      const f = localStorage.getItem("sloy_favorites");
      if (c) setCart(JSON.parse(c));
      if (f) setFavorites(JSON.parse(f));
    } catch (e) { /* ignore */ }
  }, []);
  useEffect(() => { localStorage.setItem("sloy_cart", JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem("sloy_favorites", JSON.stringify(favorites)); }, [favorites]);

  // --- Загрузка публичных данных ---
  const loadProducts = useCallback(async () => {
    const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false });
    if (!error && data) setProducts(data.map(mapProductFromDb));
  }, []);
  const loadReviews = useCallback(async () => {
    // Публично видны только approved=true, но админ должен видеть все — грузим отдельно ниже для админа
    const { data, error } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
    if (!error && data) setReviews(data.map(mapReviewFromDb));
  }, []);
  const loadNews = useCallback(async () => {
    const { data, error } = await supabase.from("news").select("*").order("created_at", { ascending: false });
    if (!error && data) setNews(data.map((n) => ({ id: n.id, title: n.title, text: n.text, image: n.image, link: n.link, date: n.created_at })));
  }, []);
  const loadPromos = useCallback(async () => {
    const { data, error } = await supabase.from("promos").select("*").order("created_at", { ascending: false });
    if (!error && data) setPromos(data.map((p) => ({ id: p.id, title: p.title, description: p.description, discount: p.discount, endDate: p.end_date, productIds: p.product_ids || [], image: p.image })));
  }, []);

  const loadCategories = useCallback(async () => {
    const { data, error } = await supabase.from("categories").select("*").order("sort_order", { ascending: true });
    if (!error && data) setCategories(data.map((c) => ({ id: c.slug, name: c.name, emoji: c.emoji, sortOrder: c.sort_order })));
  }, []);

  const loadHeroSlides = useCallback(async () => {
    const { data, error } = await supabase.from("hero_slides").select("*").order("sort_order", { ascending: true });
    if (!error && data) setHeroSlides(data.filter((s) => s.active).map((s) => ({ id: s.id, title: s.title, text: s.text, image: s.image, ctaText: s.cta_text, ctaPage: s.cta_page, sortOrder: s.sort_order })));
  }, []);

  const loadAllHeroSlidesForAdmin = useCallback(async () => {
    const { data, error } = await supabase.from("hero_slides").select("*").order("sort_order", { ascending: true });
    if (!error && data) setAllHeroSlides(data.map((s) => ({ id: s.id, title: s.title, text: s.text, image: s.image, ctaText: s.cta_text, ctaPage: s.cta_page, sortOrder: s.sort_order, active: s.active })));
  }, []);

  // --- Данные, зависящие от авторизации ---
  const loadMyOrders = useCallback(async (userId) => {
    if (!userId) { setOrders([]); return; }
    const { data, error } = await supabase.from("orders").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (!error && data) setOrders(data.map(mapOrderFromDb));
  }, []);
  const loadMyFavorites = useCallback(async (userId) => {
    if (!userId) return;
    const { data, error } = await supabase.from("favorites").select("product_id").eq("user_id", userId);
    if (!error && data) setFavorites(data.map((f) => f.product_id));
  }, []);
  const loadMyNotifications = useCallback(async (userId) => {
    if (!userId) { setNotifications([]); return; }
    const { data, error } = await supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (!error && data) setNotifications(data.map((n) => ({ id: n.id, userId: n.user_id, text: n.text, date: n.created_at, read: n.read })));
  }, []);
  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!error && data) setProfile({ name: data.name, phone: data.phone, address: data.address, city: data.city, zip: data.zip });
  }, []);

  // Данные только для админа (все заказы всех пользователей, все заявки)
  const loadAllOrdersForAdmin = useCallback(async () => {
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (!error && data) setOrders(data.map(mapOrderFromDb));
  }, []);
  const loadAllUsersForAdmin = useCallback(async () => {
    const { data, error } = await supabase.from("profiles").select("*");
    if (!error && data) setUsers(data.map((u) => ({ id: u.id, name: u.name, phone: u.phone, email: "" })));
  }, []);
  const loadCustomRequestsForAdmin = useCallback(async () => {
    const { data, error } = await supabase.from("custom_requests").select("*").order("created_at", { ascending: false });
    if (!error && data) setCustomRequests(data.map((r) => ({ id: r.id, name: r.name, phone: r.phone, description: r.description, size: r.size, color: r.color, qty: r.qty, budget: r.budget, comment: r.comment, date: r.created_at, status: r.status })));
  }, []);

  // --- Инициализация: сессия + публичные данные ---
  useEffect(() => {
    (async () => {
      await Promise.all([loadProducts(), loadReviews(), loadNews(), loadPromos(), loadCategories(), loadHeroSlides()]);
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      setReady(true);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadProducts, loadReviews, loadNews, loadPromos, loadCategories, loadHeroSlides]);

  // При смене сессии — подгружаем персональные данные
  useEffect(() => {
    const userId = session?.user?.id || null;
    const admin = session && ADMIN_EMAILS.includes(session.user?.email);
    loadProfile(userId);
    loadMyNotifications(userId);
    if (admin) {
      loadAllOrdersForAdmin();
      loadAllUsersForAdmin();
      loadCustomRequestsForAdmin();
      loadAllHeroSlidesForAdmin();
      loadPromoCodesForAdmin();
    } else {
      loadMyOrders(userId);
    }
  }, [session, loadProfile, loadMyNotifications, loadAllOrdersForAdmin, loadAllUsersForAdmin, loadCustomRequestsForAdmin, loadMyOrders, loadAllHeroSlidesForAdmin, loadPromoCodesForAdmin]);

  /* --- Авторизация --- */
  const register = useCallback(async (data) => {
    const { data: signData, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { data: { name: data.name, phone: data.phone } },
    });
    if (error) return { ok: false, error: error.message === "User already registered" ? "Пользователь с такой почтой уже зарегистрирован." : error.message };
    if (signData.user) {
      await supabase.from("profiles").insert({ id: signData.user.id, name: data.name, phone: data.phone });
    }
    return { ok: true };
  }, []);

  const login = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: "Неверная почта или пароль." };
    return { ok: true, admin: ADMIN_EMAILS.includes(data.user.email) };
  }, []);

  const verifySignupCode = useCallback(async (email, token) => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "signup" });
    if (error) return { ok: false, error: "Неверный или устаревший код. Проверьте и попробуйте снова." };
    return { ok: true };
  }, []);

  const resendSignupCode = useCallback(async (email) => {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const updateProfile = useCallback(async (patch) => {
    if (!session?.user?.id) return;
    await supabase.from("profiles").upsert({ id: session.user.id, ...patch });
    setProfile((p) => ({ ...p, ...patch }));
  }, [session]);

  /* --- Корзина (локально) --- */
  const addToCart = useCallback((productId, color, qty = 1) => {
    setCart((c) => {
      const idx = c.findIndex((i) => i.productId === productId && i.color === color);
      if (idx >= 0) {
        const copy = [...c];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + qty };
        return copy;
      }
      return [...c, { productId, color, qty }];
    });
    showToast("Добавлено в корзину");
  }, [showToast]);
  const updateCartQty = useCallback((productId, color, qty) => {
    setCart((c) => c.map((i) => (i.productId === productId && i.color === color ? { ...i, qty: Math.max(1, qty) } : i)));
  }, []);
  const removeFromCart = useCallback((productId, color) => {
    setCart((c) => c.filter((i) => !(i.productId === productId && i.color === color)));
  }, []);
  const clearCart = useCallback(() => setCart([]), []);

  /* --- Избранное (в базе, привязано к аккаунту) --- */
  const toggleFavorite = useCallback(async (productId) => {
    if (!session?.user?.id) {
      // Гость — храним только локально
      setFavorites((f) => (f.includes(productId) ? f.filter((id) => id !== productId) : [...f, productId]));
      return;
    }
    const userId = session.user.id;
    if (favorites.includes(productId)) {
      await supabase.from("favorites").delete().eq("user_id", userId).eq("product_id", productId);
      setFavorites((f) => f.filter((id) => id !== productId));
    } else {
      await supabase.from("favorites").insert({ user_id: userId, product_id: productId });
      setFavorites((f) => [...f, productId]);
    }
  }, [session, favorites]);

  /* --- Заказы --- */
  const createOrder = useCallback(async (formData, cartItems, appliedPromo) => {
    const items = cartItems.map((ci) => {
      const p = products.find((pp) => pp.id === ci.productId);
      return { productId: ci.productId, name: p?.name || "Товар", price: p ? salePrice(p) : 0, qty: ci.qty, color: ci.color };
    });
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const discountAmount = appliedPromo ? Math.round(subtotal * (appliedPromo.discountPercent / 100)) : 0;
    const total = subtotal - discountAmount;
    const payload = {
      user_id: session?.user?.id || null,
      customer_name: `${formData.firstName} ${formData.lastName}`.trim(),
      phone: formData.phone, address: formData.address, city: formData.city, zip: formData.zip,
      comment: formData.comment || "", items, total, status: "new",
      promo_code: appliedPromo ? appliedPromo.code : null,
      discount_amount: discountAmount || null,
    };
    const { data, error } = await supabase.from("orders").insert(payload).select().single();
    if (error) { showToast("Не удалось оформить заказ: " + error.message); return null; }
    const order = mapOrderFromDb(data);
    setOrders((o) => [order, ...o]);
    clearCart();
    if (appliedPromo) registerPromoCodeUse(appliedPromo.id, appliedPromo.usedCount);
    if (session?.user?.id) {
      await supabase.from("notifications").insert({ user_id: session.user.id, text: `Ваш заказ №${order.number} принят.` });
      loadMyNotifications(session.user.id);
    }
    return order;
  }, [products, session, clearCart, showToast, loadMyNotifications, registerPromoCodeUse]);

  const updateOrderStatus = useCallback(async (orderId, status) => {
    const { data, error } = await supabase.from("orders").update({ status }).eq("id", orderId).select().single();
    if (error) { showToast("Ошибка обновления статуса"); return; }
    setOrders((os) => os.map((o) => (o.id === orderId ? mapOrderFromDb(data) : o)));
    const statusText = {
      confirmed: `Ваш заказ №${data.number} подтверждён.`,
      in_production: `Ваш заказ №${data.number} передан в производство.`,
      ready: `Ваш заказ №${data.number} готов.`,
      shipped: `Ваш заказ №${data.number} отправлен.`,
      received: `Спасибо! Заказ №${data.number} отмечен как полученный.`,
      cancelled: `Заказ №${data.number} отменён.`,
    }[status];
    if (statusText && data.user_id) {
      await supabase.from("notifications").insert({ user_id: data.user_id, text: statusText });
    }
  }, [showToast]);

  /* --- Товары (админ) --- */
  const addProduct = useCallback(async (product) => {
    const { data, error } = await supabase.from("products").insert(mapProductToDb(product)).select().single();
    if (error) { showToast("Ошибка: " + error.message); return; }
    setProducts((ps) => [mapProductFromDb(data), ...ps]);
  }, [showToast]);
  const updateProduct = useCallback(async (id, patch) => {
    const { data, error } = await supabase.from("products").update(mapProductToDb({ ...patch })).eq("id", id).select().single();
    if (error) { showToast("Ошибка: " + error.message); return; }
    setProducts((ps) => ps.map((p) => (p.id === id ? mapProductFromDb(data) : p)));
  }, [showToast]);
  const deleteProduct = useCallback(async (id) => {
    await supabase.from("products").delete().eq("id", id);
    setProducts((ps) => ps.filter((p) => p.id !== id));
  }, []);

  /* --- Категории (админ) --- */
  const addCategory = useCallback(async (name, emoji) => {
    const slug = uid("cat");
    const sortOrder = categories.length ? Math.max(...categories.map((c) => c.sortOrder || 0)) + 1 : 1;
    const { error } = await supabase.from("categories").insert({ slug, name, emoji, sort_order: sortOrder });
    if (error) { showToast("Ошибка: " + error.message); return; }
    setCategories((cs) => [...cs, { id: slug, name, emoji, sortOrder }]);
  }, [categories, showToast]);

  const updateCategory = useCallback(async (slug, patch) => {
    const { error } = await supabase.from("categories").update({ name: patch.name, emoji: patch.emoji }).eq("slug", slug);
    if (error) { showToast("Ошибка: " + error.message); return; }
    setCategories((cs) => cs.map((c) => (c.id === slug ? { ...c, ...patch } : c)));
  }, [showToast]);

  const deleteCategory = useCallback(async (slug) => {
    await supabase.from("categories").delete().eq("slug", slug);
    setCategories((cs) => cs.filter((c) => c.id !== slug));
  }, []);

  /* --- Слайды баннера (админ) --- */
  const addHeroSlide = useCallback(async (slide) => {
    const sortOrder = allHeroSlides.length ? Math.max(...allHeroSlides.map((s) => s.sortOrder || 0)) + 1 : 1;
    const payload = { title: slide.title, text: slide.text, image: slide.image, cta_text: slide.ctaText, cta_page: slide.ctaPage, sort_order: sortOrder, active: true };
    const { data, error } = await supabase.from("hero_slides").insert(payload).select().single();
    if (error) { showToast("Ошибка: " + error.message); return; }
    const mapped = { id: data.id, title: data.title, text: data.text, image: data.image, ctaText: data.cta_text, ctaPage: data.cta_page, sortOrder: data.sort_order, active: data.active };
    setAllHeroSlides((s) => [...s, mapped]);
    if (mapped.active) setHeroSlides((s) => [...s, mapped]);
  }, [allHeroSlides, showToast]);

  const updateHeroSlide = useCallback(async (id, patch) => {
    const payload = { title: patch.title, text: patch.text, image: patch.image, cta_text: patch.ctaText, cta_page: patch.ctaPage, active: patch.active };
    const { error } = await supabase.from("hero_slides").update(payload).eq("id", id);
    if (error) { showToast("Ошибка: " + error.message); return; }
    setAllHeroSlides((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    loadHeroSlides();
  }, [showToast, loadHeroSlides]);

  const deleteHeroSlide = useCallback(async (id) => {
    await supabase.from("hero_slides").delete().eq("id", id);
    setAllHeroSlides((s) => s.filter((x) => x.id !== id));
    setHeroSlides((s) => s.filter((x) => x.id !== id));
  }, []);

  /* --- Отзывы --- */
  const addReview = useCallback(async (productId, rating, text, photo) => {
    if (!session?.user?.id) { showToast("Войдите, чтобы оставить отзыв"); return; }
    const payload = { product_id: productId, user_id: session.user.id, user_name: currentUser?.name || session.user.email, rating, text, photo: photo || null, approved: false };
    const { data, error } = await supabase.from("reviews").insert(payload).select().single();
    if (error) { showToast("Не удалось отправить отзыв"); return; }
    setReviews((rv) => [mapReviewFromDb(data), ...rv]);
    showToast("Отзыв отправлен на модерацию");
  }, [session, currentUser, showToast]);
  const moderateReview = useCallback(async (id, approved) => {
    if (approved) {
      const { data, error } = await supabase.from("reviews").update({ approved: true }).eq("id", id).select().single();
      if (!error) setReviews((rv) => rv.map((r) => (r.id === id ? mapReviewFromDb(data) : r)));
    } else {
      await supabase.from("reviews").delete().eq("id", id);
      setReviews((rv) => rv.filter((r) => r.id !== id));
    }
  }, []);

  /* --- Новости (админ) --- */
  const addNews = useCallback(async (data) => {
    const { data: row, error } = await supabase.from("news").insert(data).select().single();
    if (error) { showToast("Ошибка: " + error.message); return; }
    setNews((ns) => [{ id: row.id, title: row.title, text: row.text, image: row.image, link: row.link, date: row.created_at }, ...ns]);
  }, [showToast]);
  const deleteNews = useCallback(async (id) => {
    await supabase.from("news").delete().eq("id", id);
    setNews((ns) => ns.filter((n) => n.id !== id));
  }, []);

  /* --- Акции (админ) --- */
  const addPromo = useCallback(async (data) => {
    const payload = { title: data.title, description: data.description, image: data.image || null, discount: data.discount ? Number(data.discount) : null, end_date: data.endDate || null, product_ids: [] };
    const { data: row, error } = await supabase.from("promos").insert(payload).select().single();
    if (error) { showToast("Ошибка: " + error.message); return; }
    setPromos((ps) => [{ id: row.id, title: row.title, description: row.description, discount: row.discount, endDate: row.end_date, productIds: row.product_ids || [], image: row.image }, ...ps]);
  }, [showToast]);
  const updatePromo = useCallback(async (id, data) => {
    const payload = { title: data.title, description: data.description, image: data.image || null, discount: data.discount ? Number(data.discount) : null, end_date: data.endDate || null };
    const { data: row, error } = await supabase.from("promos").update(payload).eq("id", id).select().single();
    if (error) { showToast("Ошибка: " + error.message); return; }
    setPromos((ps) => ps.map((p) => (p.id === id ? { id: row.id, title: row.title, description: row.description, discount: row.discount, endDate: row.end_date, productIds: row.product_ids || [], image: row.image } : p)));
  }, [showToast]);
  const deletePromo = useCallback(async (id) => {
    await supabase.from("promos").delete().eq("id", id);
    setPromos((ps) => ps.filter((p) => p.id !== id));
  }, []);

  /* --- Промокоды --- */
  const loadPromoCodesForAdmin = useCallback(async () => {
    const { data, error } = await supabase.from("promo_codes").select("*").order("created_at", { ascending: false });
    if (!error && data) setPromoCodes(data.map((c) => ({ id: c.id, code: c.code, discountPercent: c.discount_percent, active: c.active, maxUses: c.max_uses, usedCount: c.used_count, expiresAt: c.expires_at })));
  }, []);

  const addPromoCode = useCallback(async (data) => {
    const payload = { code: data.code.trim().toUpperCase(), discount_percent: Number(data.discountPercent) || 0, max_uses: data.maxUses ? Number(data.maxUses) : null, expires_at: data.expiresAt || null, active: true };
    const { data: row, error } = await supabase.from("promo_codes").insert(payload).select().single();
    if (error) { showToast("Ошибка: " + error.message); return; }
    setPromoCodes((cs) => [{ id: row.id, code: row.code, discountPercent: row.discount_percent, active: row.active, maxUses: row.max_uses, usedCount: row.used_count, expiresAt: row.expires_at }, ...cs]);
  }, [showToast]);

  const togglePromoCodeActive = useCallback(async (id, active) => {
    await supabase.from("promo_codes").update({ active }).eq("id", id);
    setPromoCodes((cs) => cs.map((c) => (c.id === id ? { ...c, active } : c)));
  }, []);

  const deletePromoCode = useCallback(async (id) => {
    await supabase.from("promo_codes").delete().eq("id", id);
    setPromoCodes((cs) => cs.filter((c) => c.id !== id));
  }, []);

  const validatePromoCode = useCallback(async (codeInput) => {
    const code = (codeInput || "").trim().toUpperCase();
    if (!code) return { ok: false, error: "Введите промокод." };
    const { data, error } = await supabase.from("promo_codes").select("*").eq("code", code).maybeSingle();
    if (error || !data) return { ok: false, error: "Промокод не найден." };
    if (!data.active) return { ok: false, error: "Промокод больше не действует." };
    if (data.expires_at && new Date(data.expires_at) < new Date()) return { ok: false, error: "Срок действия промокода истёк." };
    if (data.max_uses && data.used_count >= data.max_uses) return { ok: false, error: "Промокод уже использован максимальное число раз." };
    return { ok: true, id: data.id, code: data.code, discountPercent: data.discount_percent, usedCount: data.used_count };
  }, []);

  const registerPromoCodeUse = useCallback(async (id, currentUsedCount) => {
    await supabase.from("promo_codes").update({ used_count: currentUsedCount + 1 }).eq("id", id);
  }, []);

  /* --- Заявки "Заказать своё" --- */
  const submitCustomRequest = useCallback(async (data) => {
    const payload = {
      user_id: session?.user?.id || null, name: data.name, phone: data.phone, description: data.description,
      size: data.size, color: data.color, qty: Number(data.qty) || 1, budget: data.budget, comment: data.comment,
    };
    const { error } = await supabase.from("custom_requests").insert(payload);
    if (error) { showToast("Не удалось отправить заявку"); return; }
    showToast("Заявка отправлена!");
  }, [session, showToast]);

  const value = {
    ready, products, reviews, news, promos, orders, users, cart, favorites, customRequests, notifications,
    categories, heroSlides, allHeroSlides, promoCodes,
    currentUser, isAdmin, toast, showToast,
    register, login, logout, updateProfile, verifySignupCode, resendSignupCode,
    addToCart, updateCartQty, removeFromCart, clearCart,
    toggleFavorite, createOrder, updateOrderStatus,
    addProduct, updateProduct, deleteProduct,
    addCategory, updateCategory, deleteCategory,
    addHeroSlide, updateHeroSlide, deleteHeroSlide,
    addPromoCode, togglePromoCodeActive, deletePromoCode, validatePromoCode,
    addReview, moderateReview, addNews, deleteNews, addPromo, updatePromo, deletePromo, submitCustomRequest,
  };

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

/* =========================================================
   МЕЛКИЕ UI-КОМПОНЕНТЫ
   ========================================================= */

function Logo({ size = 38 }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <defs>
          <linearGradient id="logoGrad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#C77B4A" />
            <stop offset="1" stopColor="#8B4A2A" />
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="42" height="42" rx="14" fill="url(#logoGrad)" />
        <text x="24" y="32" textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontWeight="600" fontSize="24" fill="#FAF7F2">P</text>
        <circle cx="35" cy="35" r="3.2" fill="#FAF7F2" opacity="0.9" />
      </svg>
      <div className="leading-none">
        <div className="font-display text-[19px] tracking-tight text-ink">PlastMaster</div>
        <div className="text-[9.5px] tracking-[0.18em] uppercase text-stone">мастерская 3D</div>
      </div>
    </div>
  );
}

function Stars({ value, size = 14 }) {
  const full = Math.round(value);
  return (
    <div className="flex items-center gap-0.5" aria-label={`Рейтинг ${value} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} strokeWidth={0} fill={i <= full ? "#C77B4A" : "#E3DCCB"} />
      ))}
    </div>
  );
}

function InteractiveStars({ value, onChange, size = 26 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" onClick={() => onChange(i)} className="transition-transform active:scale-90" aria-label={`Поставить ${i} звёзд`}>
          <Star size={size} strokeWidth={i <= value ? 0 : 1.5} fill={i <= value ? "#C77B4A" : "transparent"} stroke="#C7B9A0" />
        </button>
      ))}
    </div>
  );
}

function Badge({ children, tone = "accent" }) {
  const tones = {
    accent: "bg-accent/12 text-accent-dark",
    sage: "bg-sage/15 text-sage-dark",
    stone: "bg-stone/15 text-stone-dark",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

function PrimaryButton({ children, onClick, className = "", type = "button", disabled, full }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${full ? "w-full" : ""} inline-flex items-center justify-center gap-2 rounded-lg bg-ink text-cream px-5 py-3 text-[14.5px] font-semibold tracking-wide transition-all active:scale-[0.97] hover:bg-accent-dark disabled:opacity-40 disabled:pointer-events-none ${className}`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, className = "", full, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${full ? "w-full" : ""} inline-flex items-center justify-center gap-2 rounded-lg border transition-all active:scale-[0.97] px-5 py-3 text-[14.5px] font-medium ${
        active ? "bg-ink text-cream border-ink" : "border-line text-ink hover:border-accent hover:text-accent-dark"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function IconButton({ children, onClick, badge, label }) {
  return (
    <button onClick={onClick} aria-label={label} className="relative w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 active:scale-90 transition-all">
      {children}
      {badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

function Section({ children, className = "", id }) {
  return <section id={id} className={`px-5 md:px-10 ${className}`}>{children}</section>;
}

function SectionHeader({ eyebrow, title, action }) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        {eyebrow && <div className="text-[11px] tracking-[0.18em] uppercase text-accent-dark font-medium mb-1">{eyebrow}</div>}
        <h2 className="font-display text-[26px] md:text-[30px] text-ink leading-tight">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function Toast({ text }) {
  if (!text) return null;
  return (
    <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-[200] bg-ink text-cream px-5 py-3 rounded-full text-[14px] shadow-xl animate-toast-in flex items-center gap-2">
      <CheckCircle2 size={16} className="text-accent" />
      {text}
    </div>
  );
}

function EmptyState({ icon, title, subtitle, action }) {
  const Icon = icon;
  return (
    <div className="flex flex-col items-center text-center py-16 px-6">
      <div className="w-16 h-16 rounded-full bg-line/60 flex items-center justify-center mb-4">
        <Icon size={26} className="text-stone" />
      </div>
      <div className="font-display text-[19px] text-ink mb-1">{title}</div>
      {subtitle && <div className="text-[14px] text-stone max-w-xs">{subtitle}</div>}
      {action}
    </div>
  );
}

/* Товарная карточка */
function ProductCard({ product, onOpen }) {
  const { favorites, toggleFavorite, addToCart } = useShop();
  const isFav = favorites.includes(product.id);
  const price = salePrice(product);
  return (
    <div className="group flex flex-col rounded-xl bg-white border border-line overflow-hidden transition-all hover:shadow-md">
      <div className="relative aspect-square overflow-hidden bg-line/40 cursor-pointer" onClick={() => onOpen(product)}>
        <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {product.sale && <span className="bg-accent text-white text-[11px] font-bold px-1.5 py-0.5 rounded">-{product.sale}%</span>}
          {product.isNew && !product.sale && <span className="bg-sage text-white text-[10.5px] font-medium px-1.5 py-0.5 rounded">Новинка</span>}
          {!product.inStock && <span className="bg-stone text-white text-[10.5px] font-medium px-1.5 py-0.5 rounded">Нет в наличии</span>}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }}
          aria-label="В избранное"
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/95 backdrop-blur flex items-center justify-center active:scale-90 transition-transform"
        >
          <Heart size={15} strokeWidth={2} fill={isFav ? "#CB11AB" : "none"} stroke={isFav ? "#CB11AB" : "#1A1A1A"} />
        </button>
      </div>
      <div className="p-2.5 flex flex-col gap-1 flex-1">
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-0.5 bg-sage/12 text-sage-dark text-[11px] font-semibold px-1.5 py-0.5 rounded">
            <Star size={10} strokeWidth={0} fill="currentColor" /> {product.rating.toFixed(1)}
          </span>
          <span className="text-[11px] text-stone">{product.reviewsCount} отзывов</span>
        </div>
        <div className="text-[13px] text-ink leading-snug line-clamp-2 cursor-pointer min-h-[34px]" onClick={() => onOpen(product)}>{product.name}</div>
        <div className="flex items-baseline gap-1.5 mt-auto pt-1">
          <span className="font-display text-[17px] text-ink">{formatPrice(price)}</span>
          {product.sale && <span className="text-[12px] text-stone line-through">{formatPrice(product.price)}</span>}
        </div>
        <button
          onClick={() => product.inStock && addToCart(product.id, product.colors?.[0] || null, 1)}
          disabled={!product.inStock}
          className="mt-1.5 w-full py-2 rounded-lg bg-cart hover:bg-cart-dark text-white text-[13px] font-medium flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all disabled:opacity-30"
        >
          <ShoppingCart size={14} /> В корзину
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   НАВИГАЦИЯ
   ========================================================= */

const NAV_ITEMS = [
  { id: "home", label: "Главная" },
  { id: "catalog", label: "Каталог" },
  { id: "promos", label: "Акции" },
  { id: "custom", label: "Заказать своё" },
  { id: "news", label: "Новости" },
  { id: "reviews", label: "Отзывы" },
  { id: "contacts", label: "Контакты" },
];

function Header({ page, go, search, setSearch }) {
  const { cart, currentUser, isAdmin } = useShop();
  const { dark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <>
      <header className="sticky top-0 z-50 bg-cream/92 backdrop-blur-md border-b border-line/70">
        <div className="px-4 md:px-10 h-16 flex items-center justify-between gap-3">
          <button onClick={() => setMenuOpen(true)} className="md:hidden w-9 h-9 flex items-center justify-center -ml-1.5" aria-label="Меню">
            <Menu size={22} className="text-ink" />
          </button>
          <button onClick={() => go("home")} className="shrink-0">
            <Logo size={34} />
          </button>
          <nav className="hidden md:flex items-center gap-6 mx-auto">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                className={`text-[14px] tracking-wide transition-colors ${page === item.id ? "text-accent-dark font-medium" : "text-ink/70 hover:text-ink"}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-0.5">
            <IconButton label={dark ? "Светлая тема" : "Тёмная тема"} onClick={toggleTheme}>
              {dark ? <Sun size={19} className="text-ink" /> : <Moon size={19} className="text-ink" />}
            </IconButton>
            <IconButton label="Поиск" onClick={() => setSearchOpen(true)}><Search size={19} className="text-ink" /></IconButton>
            <div className="hidden md:block"><IconButton label="Избранное" onClick={() => go("favorites")}><Heart size={19} className="text-ink" /></IconButton></div>
            <IconButton label="Корзина" badge={cartCount} onClick={() => go("cart")}><ShoppingCart size={19} className="text-ink" /></IconButton>
            <div className="hidden md:block">
              <IconButton label="Личный кабинет" onClick={() => go(isAdmin ? "admin" : currentUser ? "account" : "auth")}>
                <User size={19} className="text-ink" />
              </IconButton>
            </div>
          </div>
        </div>
      </header>

      {searchOpen && (
        <div className="fixed inset-0 z-[100] bg-ink/40 backdrop-blur-sm flex items-start justify-center pt-20 px-4" onClick={() => setSearchOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border border-line rounded-full px-4 py-3">
              <Search size={18} className="text-stone shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Например: брелок"
                className="flex-1 outline-none text-[15px] bg-transparent"
                onKeyDown={(e) => { if (e.key === "Enter") { go("catalog"); setSearchOpen(false); } }}
              />
              {search && <button onClick={() => setSearch("")}><X size={16} className="text-stone" /></button>}
            </div>
            <PrimaryButton full className="mt-3" onClick={() => { go("catalog"); setSearchOpen(false); }}>Найти товары</PrimaryButton>
          </div>
        </div>
      )}

      {menuOpen && (
        <div className="fixed inset-0 z-[100] bg-ink/40 backdrop-blur-sm md:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-[82%] max-w-xs bg-cream shadow-2xl p-5 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <Logo size={32} />
              <button onClick={() => setMenuOpen(false)} className="w-9 h-9 flex items-center justify-center"><X size={20} /></button>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <button key={item.id} onClick={() => { go(item.id); setMenuOpen(false); }} className={`text-left px-3 py-3 rounded-xl text-[15px] ${page === item.id ? "bg-accent/10 text-accent-dark font-medium" : "text-ink"}`}>
                  {item.label}
                </button>
              ))}
              <div className="h-px bg-line my-2" />
              <button onClick={() => { go("favorites"); setMenuOpen(false); }} className="text-left px-3 py-3 rounded-xl text-[15px] flex items-center gap-2"><Heart size={17} /> Избранное</button>
              <button onClick={() => { go("cart"); setMenuOpen(false); }} className="text-left px-3 py-3 rounded-xl text-[15px] flex items-center gap-2"><ShoppingCart size={17} /> Корзина</button>
              <button onClick={() => { go(isAdmin ? "admin" : currentUser ? "account" : "auth"); setMenuOpen(false); }} className="text-left px-3 py-3 rounded-xl text-[15px] flex items-center gap-2"><User size={17} /> {currentUser || isAdmin ? "Личный кабинет" : "Войти"}</button>
              <button onClick={toggleTheme} className="text-left px-3 py-3 rounded-xl text-[15px] flex items-center gap-2">{dark ? <Sun size={17} /> : <Moon size={17} />} {dark ? "Светлая тема" : "Тёмная тема"}</button>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

function BottomNav({ page, go }) {
  const { cart, favorites, currentUser, isAdmin } = useShop();
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const items = [
    { id: "home", label: "Главная", icon: HomeIcon },
    { id: "catalog", label: "Каталог", icon: Grid3x3 },
    { id: "favorites", label: "Избранное", icon: Heart, badge: favorites.length },
    { id: "cart", label: "Корзина", icon: ShoppingCart, badge: cartCount },
    { id: "account", label: "Профиль", icon: User },
  ];
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-cream/95 backdrop-blur-md border-t border-line/70 flex items-stretch pb-[env(safe-area-inset-bottom)]">
      {items.map((it) => {
        const Icon = it.icon;
        const activePage = it.id === "account" && (page === "auth" || page === "admin") ? true : page === it.id;
        const target = it.id === "account" ? (isAdmin ? "admin" : currentUser ? "account" : "auth") : it.id;
        return (
          <button key={it.id} onClick={() => go(target)} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 relative">
            <div className="relative">
              <Icon size={21} strokeWidth={activePage ? 2.3 : 1.8} className={activePage ? "text-accent-dark" : "text-stone"} />
              {it.badge > 0 && <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">{it.badge > 9 ? "9+" : it.badge}</span>}
            </div>
            <span className={`text-[10px] ${activePage ? "text-accent-dark font-medium" : "text-stone"}`}>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Footer({ go }) {
  return (
    <footer className="bg-ink text-cream/90 mt-16 pb-24 md:pb-8">
      <Section className="pt-14 pb-8">
        <div className="grid md:grid-cols-4 gap-8">
          <div>
            <Logo size={34} />
            <p className="text-[13.5px] text-cream/60 mt-3 leading-relaxed">Небольшая мастерская 3D-печати. Создаём изделия с душой — от брелоков до предметов на заказ.</p>
          </div>
          <div>
            <div className="text-[12px] uppercase tracking-wider text-cream/50 mb-3">Разделы</div>
            <div className="flex flex-col gap-2">
              {NAV_ITEMS.map((i) => <button key={i.id} onClick={() => go(i.id)} className="text-left text-[14px] text-cream/80 hover:text-accent w-fit">{i.label}</button>)}
            </div>
          </div>
          <div>
            <div className="text-[12px] uppercase tracking-wider text-cream/50 mb-3">Контакты</div>
            <div className="flex flex-col gap-2 text-[14px] text-cream/80">
              <span className="flex items-center gap-2"><Phone size={14} /> +7 968 152-36-79</span>
              <span className="flex items-center gap-2"><MessageSquare size={14} /> WhatsApp</span>
              <span className="flex items-center gap-2"><MapPin size={14} /> Якутск, Якутия</span>
            </div>
          </div>
          <div>
            <div className="text-[12px] uppercase tracking-wider text-cream/50 mb-3">Время работы</div>
            <div className="text-[14px] text-cream/80 flex items-center gap-2"><Clock size={14} /> Пн–Сб, 10:00–19:00</div>
          </div>
        </div>
        <div className="h-px bg-cream/10 my-8" />
        <div className="text-[12.5px] text-cream/40 flex flex-col md:flex-row justify-between gap-2">
          <span>© 2026 Мастерская «PlastMaster».</span>
          <button onClick={() => go("privacy")} className="text-left hover:text-cream/70">Политика конфиденциальности</button>
        </div>
      </Section>
    </footer>
  );
}

/* =========================================================
   ГЛАВНАЯ СТРАНИЦА
   ========================================================= */

/* =========================================================
   БАННЕР-КАРУСЕЛЬ ГЛАВНОЙ (стиль маркетплейса, слайды из БД)
   ========================================================= */

function HeroCarousel({ go }) {
  const { heroSlides } = useShop();
  const [index, setIndex] = useState(0);
  const slides = heroSlides.length > 0 ? heroSlides : [{ id: "placeholder", title: "Добро пожаловать!", text: "Добавьте слайды в разделе «Баннер» админ-панели.", image: PLACEHOLDER_IMG("PlastMaster", 1200, 500, "1A1A1A", "CB11AB"), ctaText: "В каталог", ctaPage: "catalog" }];

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [slides.length, index]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % slides.length), 5000);
    return () => clearInterval(t);
  }, [slides.length]);

  const slide = slides[index] || slides[0];

  return (
    <div className="relative rounded-2xl overflow-hidden bg-ink min-h-[220px] md:min-h-[340px] flex items-end">
      <img src={slide.image || PLACEHOLDER_IMG(slide.title, 1200, 500, "1A1A1A", "CB11AB")} alt={slide.title} className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      <div className="relative p-5 md:p-10 max-w-lg">
        <h1 className="font-display text-[22px] md:text-[32px] leading-[1.15] text-white mb-2">{slide.title}</h1>
        {slide.text && <p className="text-[13px] md:text-[15px] text-white/80 mb-4 max-w-md hidden sm:block">{slide.text}</p>}
        <PrimaryButton onClick={() => go(slide.ctaPage || "catalog")} className="!bg-white !text-ink hover:!bg-white/90">{slide.ctaText || "Подробнее"} <ArrowRight size={16} /></PrimaryButton>
      </div>
      {slides.length > 1 && (
        <>
          <button onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)} aria-label="Предыдущий баннер" className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 items-center justify-center">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => setIndex((i) => (i + 1) % slides.length)} aria-label="Следующий баннер" className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 items-center justify-center">
            <ChevronRight size={18} />
          </button>
          <div className="absolute bottom-3 right-4 flex gap-1.5">
            {slides.map((s, i) => (
              <button key={s.id} onClick={() => setIndex(i)} aria-label={`Баннер ${i + 1}`} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/50"}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HomePage({ go, openProduct }) {
  const { products, reviews, news, promos, categories } = useShop();
  const popular = [...products].sort((a, b) => b.rating * b.reviewsCount - a.rating * a.reviewsCount).slice(0, 4);
  const newest = products.filter((p) => p.isNew).slice(0, 4);
  const approvedReviews = reviews.filter((r) => r.approved).slice(0, 3);

  const steps = [
    { n: "01", title: "Вы выбираете изделие", text: "Из каталога или присылаете свою идею" },
    { n: "02", title: "Печатаем на 3D-принтере", text: "Слой за слоем, с контролем каждого этапа" },
    { n: "03", title: "Обрабатываем и проверяем", text: "Убираем поддержки, шлифуем, красим при нужности" },
    { n: "04", title: "Упаковываем", text: "Бережно, чтобы изделие доехало в целости" },
    { n: "05", title: "Отправляем вам", text: "Или готовим к самовывозу" },
  ];

  return (
    <>
      {/* Баннер-карусель */}
      <Section className="pt-4 md:pt-6 pb-6">
        <HeroCarousel go={go} />
      </Section>

      {/* Категории — плитка как в приложении маркетплейса */}
      <Section className="pb-8">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {categories.map((c) => (
            <button key={c.id} onClick={() => go("catalog", { category: c.id })} className="flex flex-col items-center gap-2 group">
              <span className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white border border-line flex items-center justify-center text-2xl md:text-3xl group-hover:border-accent group-active:scale-95 transition-all">{c.emoji}</span>
              <span className="text-[11.5px] md:text-[12.5px] text-ink text-center leading-tight">{c.name}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* Популярные товары */}
      <Section className="pb-16">
        <SectionHeader eyebrow="Выбор покупателей" title="Популярные товары" action={<button onClick={() => go("catalog")} className="hidden md:flex items-center gap-1 text-[14px] text-accent-dark font-medium">Весь каталог <ArrowRight size={14} /></button>} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
          {popular.map((p) => <ProductCard key={p.id} product={p} onOpen={openProduct} />)}
        </div>
      </Section>

      {/* Новинки */}
      {newest.length > 0 && (
        <Section className="pb-16">
          <SectionHeader eyebrow="Только что напечатали" title="✨ Новинки" action={<button onClick={() => go("catalog", { filter: "new" })} className="hidden md:flex items-center gap-1 text-[14px] text-accent-dark font-medium">Все новинки <ArrowRight size={14} /></button>} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
            {newest.map((p) => <ProductCard key={p.id} product={p} onOpen={openProduct} />)}
          </div>
        </Section>
      )}

      {/* Акции */}
      {promos.length > 0 && (
        <Section className="pb-16">
          <SectionHeader eyebrow="Специальные предложения" title="🔥 Акции" />
          <div className="grid md:grid-cols-2 gap-5">
            {promos.map((promo) => (
              <div key={promo.id} className="rounded-[22px] overflow-hidden bg-white border border-line/70 flex flex-col sm:flex-row">
                <img src={promo.image} alt={promo.title} className="w-full sm:w-44 h-40 sm:h-auto object-cover shrink-0" />
                <div className="p-5 flex flex-col gap-2">
                  <Badge tone="accent">−{promo.discount}%</Badge>
                  <div className="font-display text-[18px] text-ink leading-snug">{promo.title}</div>
                  <p className="text-[13.5px] text-stone">{promo.description}</p>
                  <p className="text-[12px] text-stone">До {formatDate(promo.endDate)}</p>
                  <button onClick={() => go("promos")} className="text-[14px] text-accent-dark font-medium mt-1 flex items-center gap-1">Посмотреть товары <ArrowRight size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Как мы создаём изделия */}
      <Section className="pb-16">
        <SectionHeader eyebrow="Процесс" title="Как мы создаём изделия" />
        <div className="grid md:grid-cols-5 gap-4">
          {steps.map((s, i) => (
            <div key={s.n} className="relative flex flex-col gap-2 p-5 rounded-2xl bg-white border border-line/70">
              <span className="font-display text-[26px] text-accent/50">{s.n}</span>
              <div className="text-[14.5px] text-ink font-medium leading-snug">{s.title}</div>
              <div className="text-[12.5px] text-stone leading-snug">{s.text}</div>
              {i < steps.length - 1 && <div className="hidden md:block absolute top-1/2 -right-4 w-4 h-px bg-line" />}
            </div>
          ))}
        </div>
      </Section>

      {/* Заказать на заказ CTA */}
      <Section className="pb-16">
        <div className="rounded-[24px] bg-sage/12 border border-sage/25 p-8 md:p-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="max-w-md">
            <div className="text-[11px] tracking-[0.18em] uppercase text-sage-dark mb-2">Изделие на заказ</div>
            <h3 className="font-display text-[24px] md:text-[28px] text-ink leading-tight mb-2">Не нашли то, что искали?</h3>
            <p className="text-[14.5px] text-stone">Расскажите нам, что вы хотите — и мы попробуем создать это с помощью 3D-печати, специально для вас.</p>
          </div>
          <PrimaryButton onClick={() => go("custom")} className="shrink-0">Оставить заявку <Sparkles size={16} /></PrimaryButton>
        </div>
      </Section>

      {/* Отзывы */}
      {approvedReviews.length > 0 && (
        <Section className="pb-16">
          <SectionHeader eyebrow="Нам доверяют" title="Отзывы покупателей" action={<button onClick={() => go("reviews")} className="hidden md:flex items-center gap-1 text-[14px] text-accent-dark font-medium">Все отзывы <ArrowRight size={14} /></button>} />
          <div className="grid md:grid-cols-3 gap-5">
            {approvedReviews.map((r) => (
              <div key={r.id} className="p-5 rounded-2xl bg-white border border-line/70">
                <Stars value={r.rating} />
                <p className="text-[14px] text-ink mt-3 leading-relaxed">«{r.text}»</p>
                <div className="text-[13px] text-stone mt-3">— {r.userName}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Новости */}
      {news.length > 0 && (
        <Section className="pb-16">
          <SectionHeader eyebrow="Что нового" title="📰 Новости мастерской" action={<button onClick={() => go("news")} className="hidden md:flex items-center gap-1 text-[14px] text-accent-dark font-medium">Все новости <ArrowRight size={14} /></button>} />
          <div className="grid md:grid-cols-3 gap-5">
            {news.slice(0, 3).map((n) => (
              <div key={n.id} className="rounded-2xl bg-white border border-line/70 overflow-hidden">
                {n.image && <img src={n.image} alt={n.title} className="w-full h-32 object-cover" />}
                <div className="p-5">
                  <div className="text-[12px] text-stone mb-1.5">{formatDate(n.date)}</div>
                  <div className="font-display text-[17px] text-ink leading-snug mb-1.5">{n.title}</div>
                  <p className="text-[13.5px] text-stone leading-relaxed">{n.text}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Контакты teaser */}
      <Section className="pb-4">
        <ContactsBlock compact />
      </Section>
    </>
  );
}

/* =========================================================
   КАТАЛОГ
   ========================================================= */

function CatalogPage({ openProduct, initialFilter, search, setSearch }) {
  const { products, categories } = useShop();
  const [category, setCategory] = useState(initialFilter?.category || "all");
  const [sort, setSort] = useState("popular");
  const [specialFilter, setSpecialFilter] = useState(initialFilter?.filter || "all");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (initialFilter?.category) setCategory(initialFilter.category);
    if (initialFilter?.filter) setSpecialFilter(initialFilter.filter);
  }, [initialFilter]);

  const filtered = useMemo(() => {
    let list = products.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (specialFilter === "new" && !p.isNew) return false;
      if (specialFilter === "sale" && !p.sale) return false;
      if (search) {
        const q = search.toLowerCase();
        const catName = categories.find((c) => c.id === p.category)?.name || "";
        if (!p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q) && !catName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    switch (sort) {
      case "cheap": list = [...list].sort((a, b) => salePrice(a) - salePrice(b)); break;
      case "expensive": list = [...list].sort((a, b) => salePrice(b) - salePrice(a)); break;
      case "new": list = [...list].sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0)); break;
      default: list = [...list].sort((a, b) => b.rating * b.reviewsCount - a.rating * a.reviewsCount);
    }
    return list;
  }, [products, category, sort, specialFilter, search, categories]);

  const filterChips = [{ id: "all", name: "Все товары", emoji: "🛍" }, ...categories];

  return (
    <Section className="pt-6 pb-16">
      <div className="mb-5">
        <h1 className="font-display text-[28px] md:text-[34px] text-ink mb-4">Каталог</h1>
        <div className="flex items-center gap-3 border border-line rounded-full px-4 py-2.5 bg-white">
          <Search size={17} className="text-stone shrink-0" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск товара" className="flex-1 outline-none text-[14.5px] bg-transparent" />
          {search && <button onClick={() => setSearch("")}><X size={15} className="text-stone" /></button>}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3 mb-2 -mx-5 px-5 md:mx-0 md:px-0">
        {filterChips.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`shrink-0 px-4 py-2 rounded-full text-[13.5px] border transition-all ${category === c.id ? "bg-ink text-cream border-ink" : "border-line text-ink hover:border-accent"}`}
          >
            {c.emoji} {c.name}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-5">
        <span className="text-[13.5px] text-stone">{filtered.length} товаров</span>
        <button onClick={() => setShowFilters((s) => !s)} className="flex items-center gap-1.5 text-[13.5px] text-ink">
          <SlidersHorizontal size={15} /> Сортировка <ChevronDown size={14} className={`transition-transform ${showFilters ? "rotate-180" : ""}`} />
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-2 mb-5 p-3 bg-white border border-line rounded-2xl">
          {[
            { id: "popular", label: "По популярности" },
            { id: "cheap", label: "Сначала дешёвые" },
            { id: "expensive", label: "Сначала дорогие" },
            { id: "new", label: "Новинки" },
          ].map((s) => (
            <button key={s.id} onClick={() => setSort(s.id)} className={`px-3.5 py-2 rounded-full text-[13px] border ${sort === s.id ? "bg-accent/12 border-accent text-accent-dark font-medium" : "border-line text-ink"}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={Search} title="Ничего не нашлось" subtitle="Попробуйте другой запрос или посмотрите весь каталог." />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
          {filtered.map((p) => <ProductCard key={p.id} product={p} onOpen={openProduct} />)}
        </div>
      )}
    </Section>
  );
}

/* =========================================================
   СТРАНИЦА ТОВАРА
   ========================================================= */

function ProductPage({ product, go, back }) {
  const { addToCart, favorites, toggleFavorite, reviews, currentUser, orders } = useShop();
  const [activeImg, setActiveImg] = useState(0);
  const [color, setColor] = useState(product.colors?.[0] || null);
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState("description");

  useEffect(() => { setActiveImg(0); setColor(product.colors?.[0] || null); setQty(1); }, [product.id]);

  const productReviews = reviews.filter((r) => r.productId === product.id && r.approved);
  const isFav = favorites.includes(product.id);
  const price = salePrice(product);
  const canReview = currentUser && orders.some((o) => o.userId === currentUser.id && o.status === "received" && o.items.some((i) => i.productId === product.id));

  return (
    <Section className="pt-6 pb-16">
      <button onClick={back} className="flex items-center gap-1.5 text-[13.5px] text-stone mb-5"><ChevronLeft size={16} /> Назад в каталог</button>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Галерея */}
        <div>
          <div className="aspect-square rounded-[22px] overflow-hidden bg-line/40 mb-3 relative">
            <img src={product.images[activeImg]} alt={product.name} className="w-full h-full object-cover" />
            <button onClick={() => toggleFavorite(product.id)} className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/90 backdrop-blur flex items-center justify-center">
              <Heart size={18} fill={isFav ? "#C77B4A" : "none"} stroke={isFav ? "#C77B4A" : "#2B2A28"} />
            </button>
          </div>
          <div className="flex gap-2.5">
            {product.images.map((img, i) => (
              <button key={i} onClick={() => setActiveImg(i)} className={`w-16 h-16 rounded-xl overflow-hidden border-2 ${activeImg === i ? "border-accent" : "border-transparent"}`}>
                <img src={img} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
            {product.video && (
              <button onClick={() => setActiveImg(-1)} className={`w-16 h-16 rounded-xl overflow-hidden border-2 bg-ink flex items-center justify-center ${activeImg === -1 ? "border-accent" : "border-transparent"}`}>
                <Video size={20} className="text-cream" />
              </button>
            )}
          </div>
          {activeImg === -1 && product.video && (
            <div className="mt-3 aspect-video rounded-2xl bg-ink flex items-center justify-center text-cream/70 text-[13px]">Видео товара (демо)</div>
          )}
        </div>

        {/* Инфо */}
        <div>
          <div className="flex gap-1.5 mb-2">
            {product.isNew && <Badge tone="sage">Новинка</Badge>}
            {product.sale && <Badge tone="accent">−{product.sale}% скидка</Badge>}
          </div>
          <h1 className="font-display text-[26px] md:text-[30px] text-ink leading-tight mb-2">{product.name}</h1>
          <div className="flex items-center gap-2 mb-4">
            <Stars value={product.rating} />
            <span className="text-[13.5px] text-stone">{product.rating.toFixed(1)} · {product.reviewsCount} отзывов</span>
          </div>
          <div className="flex items-baseline gap-2.5 mb-5">
            <span className="font-display text-[30px] text-ink">{formatPrice(price)}</span>
            {product.sale && <span className="text-[16px] text-stone line-through">{formatPrice(product.price)}</span>}
          </div>

          {product.colors && product.colors.length > 0 && (
            <div className="mb-5">
              <div className="text-[13px] text-stone mb-2">Цвет</div>
              <div className="flex flex-wrap gap-2">
                {product.colors.map((c) => (
                  <button key={c} onClick={() => setColor(c)} className={`px-3.5 py-2 rounded-full text-[13.5px] border ${color === c ? "bg-ink text-cream border-ink" : "border-line text-ink"}`}>{c}</button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-6">
            <div className="text-[13px] text-stone mb-2">Количество</div>
            <div className="inline-flex items-center gap-3 border border-line rounded-full px-2 py-1.5">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-line/60"><Minus size={14} /></button>
              <span className="w-6 text-center text-[14.5px]">{qty}</span>
              <button onClick={() => setQty((q) => q + 1)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-line/60"><Plus size={14} /></button>
            </div>
          </div>

          {product.inStock ? (
            <PrimaryButton full className="!bg-cart hover:!bg-cart-dark" onClick={() => addToCart(product.id, color, qty)}><ShoppingCart size={17} /> Добавить в корзину</PrimaryButton>
          ) : (
            <SecondaryButton full onClick={() => go("custom")}>Заказать похожее изделие</SecondaryButton>
          )}

          <div className="grid grid-cols-2 gap-3 mt-6 pt-6 border-t border-line">
            <div><div className="text-[12px] text-stone">Размер</div><div className="text-[14px] text-ink">{product.sizes}</div></div>
            <div><div className="text-[12px] text-stone">Материал</div><div className="text-[14px] text-ink">{product.material}</div></div>
            <div><div className="text-[12px] text-stone">Срок изготовления</div><div className="text-[14px] text-ink">{product.craftTime}</div></div>
            <div><div className="text-[12px] text-stone">Наличие</div><div className="text-[14px] text-ink">{product.inStock ? `В наличии (${product.qty} шт.)` : "Под заказ"}</div></div>
          </div>
        </div>
      </div>

      {/* Табы: описание / отзывы */}
      <div className="mt-12">
        <div className="flex gap-6 border-b border-line mb-6">
          {[{ id: "description", label: "Описание" }, { id: "reviews", label: `Отзывы (${productReviews.length})` }].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`pb-3 text-[14.5px] border-b-2 -mb-px transition-colors ${tab === t.id ? "border-accent text-ink font-medium" : "border-transparent text-stone"}`}>{t.label}</button>
          ))}
        </div>
        {tab === "description" ? (
          <p className="text-[14.5px] text-ink/85 leading-relaxed max-w-2xl">{product.description}</p>
        ) : (
          <div className="max-w-2xl">
            {productReviews.length === 0 ? (
              <p className="text-[14px] text-stone">Пока нет отзывов об этом товаре.</p>
            ) : (
              <div className="flex flex-col gap-4 mb-6">
                {productReviews.map((r) => (
                  <div key={r.id} className="p-4 rounded-2xl bg-white border border-line/70">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[14px] font-medium text-ink">{r.userName}</span>
                      <span className="text-[12px] text-stone">{formatDate(r.date)}</span>
                    </div>
                    <Stars value={r.rating} size={13} />
                    <p className="text-[14px] text-ink/85 mt-2 leading-relaxed">«{r.text}»</p>
                  </div>
                ))}
              </div>
            )}
            {canReview ? <LeaveReviewForm productId={product.id} /> : <p className="text-[13px] text-stone">Оставить отзыв можно после получения этого товара в заказе.</p>}
          </div>
        )}
      </div>

      <RelatedProducts product={product} go={go} />
    </Section>
  );
}

function RelatedProducts({ product, go }) {
  const { products } = useShop();
  const related = products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4);
  if (related.length === 0) return null;
  return (
    <div className="mt-14 pt-10 border-t border-line">
      <h2 className="font-display text-[20px] md:text-[24px] text-ink mb-5">Похожие товары</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
        {related.map((p) => <ProductCard key={p.id} product={p} onOpen={(prod) => go("product", { product: prod })} />)}
      </div>
    </div>
  );
}

function LeaveReviewForm({ productId }) {
  const { addReview } = useShop();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) return <div className="p-4 rounded-2xl bg-sage/10 text-[14px] text-sage-dark">Спасибо! Отзыв отправлен на модерацию.</div>;

  return (
    <div className="p-4 rounded-2xl bg-white border border-line/70">
      <div className="text-[14px] font-medium text-ink mb-2">Оставить отзыв</div>
      <InteractiveStars value={rating} onChange={setRating} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Расскажите, что понравилось..." rows={3} className="w-full mt-3 p-3 rounded-xl border border-line outline-none text-[14px] resize-none focus:border-accent" />
      <PrimaryButton className="mt-3" onClick={() => { if (!text.trim()) return; addReview(productId, rating, text.trim()); setSent(true); }}>Опубликовать отзыв</PrimaryButton>
    </div>
  );
}

/* =========================================================
   ИЗБРАННОЕ
   ========================================================= */

function FavoritesPage({ openProduct, go }) {
  const { favorites, products } = useShop();
  const list = products.filter((p) => favorites.includes(p.id));
  return (
    <Section className="pt-6 pb-16">
      <h1 className="font-display text-[28px] md:text-[34px] text-ink mb-5">❤️ Избранное</h1>
      {list.length === 0 ? (
        <EmptyState icon={Heart} title="Пока пусто" subtitle="Сохраняйте понравившиеся товары, нажимая на сердечко." action={<PrimaryButton className="mt-5" onClick={() => go("catalog")}>Перейти в каталог</PrimaryButton>} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
          {list.map((p) => <ProductCard key={p.id} product={p} onOpen={openProduct} />)}
        </div>
      )}
    </Section>
  );
}

/* =========================================================
   КОРЗИНА
   ========================================================= */

function CartPage({ go }) {
  const { cart, products, updateCartQty, removeFromCart, currentUser } = useShop();
  const items = cart.map((ci) => ({ ...ci, product: products.find((p) => p.id === ci.productId) })).filter((i) => i.product);
  const total = items.reduce((s, i) => s + salePrice(i.product) * i.qty, 0);
  const count = items.reduce((s, i) => s + i.qty, 0);

  return (
    <Section className="pt-6 pb-32 md:pb-16">
      <h1 className="font-display text-[28px] md:text-[34px] text-ink mb-5">Корзина</h1>
      {items.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="Корзина пуста" subtitle="Добавьте товары из каталога, чтобы оформить заказ." action={<PrimaryButton className="mt-5" onClick={() => go("catalog")}>Перейти в каталог</PrimaryButton>} />
      ) : (
        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 flex flex-col gap-3">
            {items.map((i) => (
              <div key={i.productId + (i.color || "")} className="flex gap-3 p-3 rounded-2xl bg-white border border-line/70">
                <img src={i.product.images[0]} alt={i.product.name} className="w-20 h-20 rounded-xl object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] text-ink leading-snug line-clamp-2">{i.product.name}</div>
                  {i.color && <div className="text-[12px] text-stone mt-0.5">Цвет: {i.color}</div>}
                  <div className="font-display text-[16px] text-ink mt-1">{formatPrice(salePrice(i.product))}</div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="inline-flex items-center gap-2.5 border border-line rounded-full px-1.5 py-1">
                      <button onClick={() => updateCartQty(i.productId, i.color, i.qty - 1)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-line/60"><Minus size={12} /></button>
                      <span className="w-5 text-center text-[13.5px]">{i.qty}</span>
                      <button onClick={() => updateCartQty(i.productId, i.color, i.qty + 1)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-line/60"><Plus size={12} /></button>
                    </div>
                    <button onClick={() => removeFromCart(i.productId, i.color)} aria-label="Удалить" className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-line/60 text-stone"><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="md:col-span-1">
            <div className="p-5 rounded-2xl bg-white border border-line/70 md:sticky md:top-24">
              <div className="flex justify-between text-[14px] text-stone mb-1.5"><span>Товаров</span><span>{count}</span></div>
              <div className="flex justify-between text-[18px] font-display text-ink mb-5"><span>Стоимость</span><span>{formatPrice(total)}</span></div>
              <PrimaryButton full onClick={() => go(currentUser ? "checkout" : "auth", { redirectTo: "checkout" })}>Оформить заказ</PrimaryButton>
              {!currentUser && <p className="text-[12px] text-stone mt-2 text-center">Для оформления нужно войти в аккаунт</p>}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

/* =========================================================
   ОФОРМЛЕНИЕ ЗАКАЗА
   ========================================================= */

function CheckoutPage({ go }) {
  const { cart, products, currentUser, createOrder, validatePromoCode } = useShop();
  const items = cart.map((ci) => ({ ...ci, product: products.find((p) => p.id === ci.productId) })).filter((i) => i.product);
  const subtotal = items.reduce((s, i) => s + salePrice(i.product) * i.qty, 0);

  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoError, setPromoError] = useState("");
  const [checkingPromo, setCheckingPromo] = useState(false);

  const discountAmount = appliedPromo ? Math.round(subtotal * (appliedPromo.discountPercent / 100)) : 0;
  const total = subtotal - discountAmount;

  const applyPromo = async () => {
    setPromoError("");
    setCheckingPromo(true);
    try {
      const res = await validatePromoCode(promoInput);
      if (!res.ok) { setPromoError(res.error); setAppliedPromo(null); return; }
      setAppliedPromo(res);
    } finally {
      setCheckingPromo(false);
    }
  };

  const [form, setForm] = useState({
    firstName: currentUser?.name?.split(" ")[0] || "",
    lastName: "",
    phone: currentUser?.phone || "",
    address: currentUser?.address || "",
    city: currentUser?.city || "",
    zip: currentUser?.zip || "",
    comment: "",
  });
  const [confirmed, setConfirmed] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!form.firstName || !form.lastName || !form.phone || !form.address || !form.city) {
      setError("Заполните все обязательные поля.");
      return;
    }
    if (!confirmed) { setError("Подтвердите, что данные верны."); return; }
    setError("");
    setSubmitting(true);
    try {
      const order = await createOrder(form, items, appliedPromo);
      if (!order) { setError("Не удалось оформить заказ. Попробуйте ещё раз."); return; }
      setOrderResult(order);
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0 && !orderResult) {
    return <Section className="pt-6 pb-16"><EmptyState icon={ShoppingCart} title="Корзина пуста" subtitle="Добавьте товары перед оформлением заказа." action={<PrimaryButton className="mt-5" onClick={() => go("catalog")}>В каталог</PrimaryButton>} /></Section>;
  }

  if (orderResult) {
    const waMessage = encodeURIComponent(
      `Здравствуйте! Оформил(а) заказ №${orderResult.number} на сайте PlastMaster.\n` +
      `Состав заказа:\n${orderResult.items.map((i) => `— ${i.name}${i.color ? ` (${i.color})` : ""} × ${i.qty}`).join("\n")}\n` +
      (orderResult.promoCode ? `Промокод: ${orderResult.promoCode} (скидка ${formatPrice(orderResult.discountAmount || 0)})\n` : "") +
      `Сумма: ${formatPrice(orderResult.total)}\n` +
      `Хочу уточнить оплату и доставку.`
    );
    const waLink = `https://wa.me/79681523679?text=${waMessage}`;
    return (
      <Section className="pt-16 pb-16">
        <div className="max-w-md mx-auto text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-sage/15 flex items-center justify-center mb-4"><CheckCircle2 size={30} className="text-sage-dark" /></div>
          <h1 className="font-display text-[24px] text-ink mb-2">Заказ успешно создан!</h1>
          <p className="text-[14.5px] text-stone mb-4">Напишите нам в WhatsApp, чтобы мы быстрее подтвердили заказ и согласовали оплату — сообщение уже заполнено, останется только отправить.</p>
          <div className="text-[15px] text-ink font-medium mb-6">Номер заказа: №{orderResult.number}</div>
          <a href={waLink} target="_blank" rel="noopener noreferrer" className="w-full">
            <PrimaryButton full className="!bg-[#25D366] hover:!bg-[#1DA851]">
              <MessageSquare size={17} /> Написать в WhatsApp
            </PrimaryButton>
          </a>
          <button onClick={() => go("account", { tab: "orders" })} className="text-[13.5px] text-stone mt-4 underline underline-offset-2">Мои заказы</button>
        </div>
      </Section>
    );
  }

  return (
    <Section className="pt-6 pb-32 md:pb-16">
      <h1 className="font-display text-[28px] md:text-[34px] text-ink mb-6">Оформление заказа</h1>
      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Имя *" value={form.firstName} onChange={set("firstName")} />
            <Field label="Фамилия *" value={form.lastName} onChange={set("lastName")} />
          </div>
          <Field label="Номер телефона *" value={form.phone} onChange={set("phone")} placeholder="+7 (___) ___-__-__" />
          <Field label="Адрес доставки *" value={form.address} onChange={set("address")} />
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Город *" value={form.city} onChange={set("city")} />
            <Field label="Индекс" value={form.zip} onChange={set("zip")} />
          </div>
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Комментарий к заказу</label>
            <textarea value={form.comment} onChange={set("comment")} placeholder="Например: хочу синий цвет вместо чёрного." rows={3} className="w-full p-3 rounded-xl border border-line outline-none text-[14px] resize-none focus:border-accent" />
          </div>
          <label className="flex items-start gap-2.5 mt-1 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-accent w-4 h-4" />
            <span className="text-[13.5px] text-ink">Я проверил правильность данных.</span>
          </label>
          {error && <div className="text-[13px] text-red-600">{error}</div>}
        </div>
        <div className="md:col-span-1">
          <div className="p-5 rounded-2xl bg-white border border-line/70 md:sticky md:top-24">
            <div className="text-[14px] text-ink font-medium mb-3">Ваш заказ</div>
            <div className="flex flex-col gap-2 mb-3 max-h-56 overflow-y-auto">
              {items.map((i) => (
                <div key={i.productId + (i.color || "")} className="flex justify-between text-[13px] text-stone">
                  <span className="line-clamp-1">{i.product.name} × {i.qty}</span>
                  <span className="shrink-0 ml-2 text-ink">{formatPrice(salePrice(i.product) * i.qty)}</span>
                </div>
              ))}
            </div>

            {appliedPromo ? (
              <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg bg-sage/12 text-[13px]">
                <span className="text-sage-dark font-medium flex items-center gap-1"><Percent size={13} /> {appliedPromo.code} · −{appliedPromo.discountPercent}%</span>
                <button onClick={() => { setAppliedPromo(null); setPromoInput(""); }} className="text-stone"><X size={14} /></button>
              </div>
            ) : (
              <div className="mb-3">
                <div className="flex gap-2">
                  <input value={promoInput} onChange={(e) => setPromoInput(e.target.value)} placeholder="Промокод" className="flex-1 min-w-0 p-2.5 rounded-lg border border-line outline-none text-[13.5px] focus:border-accent bg-white" />
                  <button onClick={applyPromo} disabled={checkingPromo || !promoInput.trim()} className="px-3.5 py-2.5 rounded-lg border border-line text-[13px] font-medium disabled:opacity-40">{checkingPromo ? "…" : "Применить"}</button>
                </div>
                {promoError && <div className="text-[12px] text-red-600 mt-1.5">{promoError}</div>}
              </div>
            )}

            <div className="flex flex-col gap-1 pt-3 border-t border-line mb-5">
              {discountAmount > 0 && (
                <div className="flex justify-between text-[13.5px] text-stone">
                  <span>Подытог</span><span>{formatPrice(subtotal)}</span>
                </div>
              )}
              {discountAmount > 0 && (
                <div className="flex justify-between text-[13.5px] text-sage-dark">
                  <span>Скидка по промокоду</span><span>−{formatPrice(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-[18px] font-display text-ink"><span>Итого</span><span>{formatPrice(total)}</span></div>
            </div>
            <PrimaryButton full onClick={submit} disabled={submitting}>{submitting ? "Оформляем…" : "Подтвердить заказ"}</PrimaryButton>
            <p className="text-[11.5px] text-stone mt-2 text-center">Оплата не автоматическая — мы свяжемся с вами для согласования способа оплаты.</p>
          </div>
        </div>
      </div>
    </Section>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <label className="text-[13px] text-stone mb-1.5 block">{label}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder} className="w-full p-3 rounded-xl border border-line outline-none text-[14px] focus:border-accent bg-white" />
    </div>
  );
}

/* =========================================================
   АВТОРИЗАЦИЯ
   ========================================================= */

function AuthPage({ go, redirectTo }) {
  const { register, login, verifySignupCode, resendSignupCode } = useShop();
  const [mode, setMode] = useState("login"); // login | register
  const [step, setStep] = useState("form"); // form | code
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "", password2: "" });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        const res = await login(form.email, form.password);
        if (!res.ok) return setError(res.error);
        go(res.admin ? "admin" : (redirectTo || "account"));
      } else {
        if (!form.name || !form.phone || !form.email || !form.password) return setError("Заполните все поля.");
        if (form.password !== form.password2) return setError("Пароли не совпадают.");
        if (form.password.length < 6) return setError("Пароль должен быть не короче 6 символов.");
        const res = await register(form);
        if (!res.ok) return setError(res.error);
        setError("");
        setStep("code");
      }
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async () => {
    setError("");
    if (!code || code.trim().length < 4) { setError("Введите код из письма."); return; }
    setLoading(true);
    try {
      const res = await verifySignupCode(form.email, code.trim());
      if (!res.ok) { setError(res.error); return; }
      go(redirectTo || "account");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError(""); setInfo("");
    const res = await resendSignupCode(form.email);
    setInfo(res.ok ? "Код отправлен повторно." : (res.error || "Не удалось отправить код."));
  };

  if (step === "code") {
    return (
      <Section className="pt-10 pb-20">
        <div className="max-w-sm mx-auto">
          <h1 className="font-display text-[28px] text-ink mb-1 text-center">Подтверждение почты</h1>
          <p className="text-[13.5px] text-stone text-center mb-6">Мы отправили код на {form.email}. Введите его ниже.</p>

          <Field label="Код из письма" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />

          {error && <div className="text-[13px] text-red-600 mt-3">{error}</div>}
          {info && <div className="text-[13px] text-sage-dark mt-3">{info}</div>}

          <PrimaryButton full className="mt-5" onClick={submitCode} disabled={loading}>{loading ? "Проверяем…" : "Подтвердить"}</PrimaryButton>
          <button onClick={resend} className="w-full text-center text-[13.5px] text-accent-dark mt-4">Отправить код ещё раз</button>
        </div>
      </Section>
    );
  }

  return (
    <Section className="pt-10 pb-20">
      <div className="max-w-sm mx-auto">
        <h1 className="font-display text-[28px] text-ink mb-1 text-center">{mode === "login" ? "Вход" : "Регистрация"}</h1>
        <p className="text-[13.5px] text-stone text-center mb-6">{mode === "login" ? "Рады видеть вас снова" : "Создайте аккаунт для оформления заказов"}</p>

        <div className="flex flex-col gap-3">
          {mode === "register" && <Field label="Имя" value={form.name} onChange={set("name")} />}
          {mode === "register" && <Field label="Номер телефона" value={form.phone} onChange={set("phone")} placeholder="+7 (___) ___-__-__" />}
          <Field label="Email" value={form.email} onChange={set("email")} type="email" />
          <Field label="Пароль" value={form.password} onChange={set("password")} type="password" />
          {mode === "register" && <Field label="Повторите пароль" value={form.password2} onChange={set("password2")} type="password" />}
        </div>

        {error && <div className="text-[13px] text-red-600 mt-3">{error}</div>}

        <PrimaryButton full className="mt-5" onClick={submit} disabled={loading}>{loading ? "Подождите…" : mode === "login" ? "Войти" : "Зарегистрироваться"}</PrimaryButton>
        {mode === "register" && <p className="text-[11.5px] text-stone text-center mt-3">После регистрации пришлём код подтверждения на почту.</p>}

        <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="w-full text-center text-[13.5px] text-accent-dark mt-4">
          {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
        </button>


      </div>
    </Section>
  );
}

/* =========================================================
   ЛИЧНЫЙ КАБИНЕТ
   ========================================================= */

function AccountPage({ go, initialTab }) {
  const { currentUser, logout, updateProfile, orders, favorites, products, notifications } = useShop();
  const [tab, setTab] = useState(initialTab || "profile");
  const [form, setForm] = useState(currentUser || {});
  const [saved, setSaved] = useState(false);

  useEffect(() => { setForm(currentUser || {}); }, [currentUser]);
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);

  if (!currentUser) {
    return <Section className="pt-16 pb-16"><EmptyState icon={User} title="Вы не вошли в аккаунт" subtitle="Войдите, чтобы увидеть личный кабинет." action={<PrimaryButton className="mt-5" onClick={() => go("auth")}>Войти</PrimaryButton>} /></Section>;
  }

  const myOrders = orders.filter((o) => o.userId === currentUser.id);
  const myFavorites = products.filter((p) => favorites.includes(p.id));
  const myNotifications = notifications.filter((n) => n.userId === currentUser.id);

  const tabs = [
    { id: "profile", label: "Мой профиль", icon: User },
    { id: "orders", label: "Мои заказы", icon: Package },
    { id: "favorites", label: "Избранное", icon: Heart },
    { id: "notifications", label: "Уведомления", icon: Sparkles },
  ];

  return (
    <Section className="pt-6 pb-32 md:pb-16">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-[28px] md:text-[34px] text-ink">Личный кабинет</h1>
        <button onClick={() => { logout(); go("home"); }} className="flex items-center gap-1.5 text-[13.5px] text-stone hover:text-ink"><LogOut size={15} /> Выйти</button>
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-7 -mx-5 px-5 md:mx-0 md:px-0">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[13.5px] border ${tab === t.id ? "bg-ink text-cream border-ink" : "border-line text-ink"}`}>
              <Icon size={14} /> {t.label}
              {t.id === "notifications" && myNotifications.some((n) => !n.read) && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>

      {tab === "profile" && (
        <div className="max-w-md flex flex-col gap-3.5">
          <Field label="Имя" value={form.name || ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Field label="Телефон" value={form.phone || ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <Field label="Email" value={form.email || ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          <Field label="Адрес доставки" value={form.address || ""} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          <PrimaryButton className="mt-2 w-fit" onClick={() => { updateProfile(form); setSaved(true); setTimeout(() => setSaved(false), 2000); }}>Изменить данные</PrimaryButton>
          {saved && <span className="text-[13px] text-sage-dark">Сохранено!</span>}
        </div>
      )}

      {tab === "orders" && (
        <div className="flex flex-col gap-4">
          {myOrders.length === 0 ? (
            <EmptyState icon={Package} title="Заказов пока нет" subtitle="Оформите первый заказ в каталоге." action={<PrimaryButton className="mt-5" onClick={() => go("catalog")}>В каталог</PrimaryButton>} />
          ) : myOrders.map((o) => <OrderCard key={o.id} order={o} go={go} />)}
        </div>
      )}

      {tab === "favorites" && (
        myFavorites.length === 0 ? (
          <EmptyState icon={Heart} title="Пока пусто" subtitle="Сохраняйте товары из каталога." action={<PrimaryButton className="mt-5" onClick={() => go("catalog")}>В каталог</PrimaryButton>} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
            {myFavorites.map((p) => <ProductCard key={p.id} product={p} onOpen={(prod) => go("product", { product: prod })} />)}
          </div>
        )
      )}

      {tab === "notifications" && (
        myNotifications.length === 0 ? (
          <EmptyState icon={Sparkles} title="Уведомлений нет" subtitle="Здесь будут появляться обновления по вашим заказам." />
        ) : (
          <div className="flex flex-col gap-2 max-w-lg">
            {myNotifications.map((n) => (
              <div key={n.id} className="p-3.5 rounded-xl bg-white border border-line/70 flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-accent mt-1.5 shrink-0" />
                <div>
                  <div className="text-[14px] text-ink">{n.text}</div>
                  <div className="text-[12px] text-stone mt-0.5">{formatDate(n.date)}</div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </Section>
  );
}

function OrderStatusTrack({ status }) {
  if (status === "cancelled") {
    return <div className="flex items-center gap-2 text-[13px]" style={{ color: STATUS_LABELS.cancelled.color }}>{STATUS_LABELS.cancelled.emoji} {STATUS_LABELS.cancelled.label}</div>;
  }
  const idx = STATUS_FLOW.indexOf(status);
  return (
    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
      {STATUS_FLOW.map((s, i) => (
        <React.Fragment key={s}>
          <div className="flex flex-col items-center gap-1 shrink-0 w-[64px]">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${i <= idx ? "bg-accent text-white" : "bg-line text-stone"}`}>
              {i <= idx ? <CheckCircle2 size={13} /> : <Circle size={13} />}
            </div>
            <span className={`text-[9.5px] text-center leading-tight ${i <= idx ? "text-ink" : "text-stone"}`}>{STATUS_LABELS[s].label}</span>
          </div>
          {i < STATUS_FLOW.length - 1 && <div className={`h-px w-5 shrink-0 ${i < idx ? "bg-accent" : "bg-line"}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function OrderCard({ order, go }) {
  const st = STATUS_LABELS[order.status];
  return (
    <div className="p-4 rounded-2xl bg-white border border-line/70">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[15px] font-medium text-ink">Заказ №{order.number}</span>
        <span className="text-[12px] text-stone">{formatDate(order.date)}</span>
      </div>
      <div className="flex flex-col gap-1 mb-3">
        {order.items.map((it, i) => (
          <div key={i} className="text-[13.5px] text-stone">{it.name} — {it.qty} шт.</div>
        ))}
      </div>
      <div className="flex items-center justify-between mb-3">
        <span className="font-display text-[16px] text-ink">{formatPrice(order.total)}</span>
        <Badge tone={order.status === "cancelled" ? "stone" : "accent"}>{st.emoji} {st.label}</Badge>
      </div>
      {order.promoCode && <div className="text-[12px] text-sage-dark mb-2">Промокод {order.promoCode} (−{formatPrice(order.discountAmount || 0)})</div>}
      <OrderStatusTrack status={order.status} />
      {order.status === "received" && <p className="text-[12px] text-sage-dark mt-2">Спасибо за заказ! Вы можете оставить отзыв на странице товара.</p>}
    </div>
  );
}

/* =========================================================
   ЗАКАЗАТЬ СВОЁ ИЗДЕЛИЕ
   ========================================================= */

function CustomOrderPage() {
  const { submitCustomRequest } = useShop();
  const [form, setForm] = useState({ name: "", phone: "", description: "", size: "", color: "", qty: 1, budget: "", comment: "" });
  const [images, setImages] = useState([]);
  const [sent, setSent] = useState(false);
  const fileRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 4);
    setImages(files.map((f) => URL.createObjectURL(f)));
  };

  const submit = () => {
    if (!form.name || !form.phone || !form.description) return;
    submitCustomRequest({ ...form, imagesCount: images.length });
    setSent(true);
  };

  if (sent) {
    return (
      <Section className="pt-16 pb-16">
        <div className="max-w-md mx-auto text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-sage/15 flex items-center justify-center mb-4"><CheckCircle2 size={30} className="text-sage-dark" /></div>
          <h1 className="font-display text-[22px] text-ink mb-2">Спасибо! Ваша заявка отправлена.</h1>
          <p className="text-[14.5px] text-stone">Мы свяжемся с вами и обсудим возможность изготовления.</p>
        </div>
      </Section>
    );
  }

  return (
    <Section className="pt-8 pb-32 md:pb-16">
      <div className="max-w-xl">
        <div className="text-[11px] tracking-[0.18em] uppercase text-accent-dark mb-2">Индивидуальный заказ</div>
        <h1 className="font-display text-[28px] md:text-[32px] text-ink mb-2">Закажи своё изделие</h1>
        <p className="text-[14.5px] text-stone mb-7">Не нашли подходящий товар? Расскажите нам, что вы хотите, и мы попробуем создать это с помощью 3D-печати.</p>

        <div className="flex flex-col gap-3.5">
          <Field label="Ваше имя *" value={form.name} onChange={set("name")} />
          <Field label="Номер телефона *" value={form.phone} onChange={set("phone")} placeholder="+7 (___) ___-__-__" />
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Что вы хотите изготовить? *</label>
            <textarea value={form.description} onChange={set("description")} rows={4} placeholder="Опишите идею как можно подробнее..." className="w-full p-3 rounded-xl border border-line outline-none text-[14px] resize-none focus:border-accent bg-white" />
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Желаемый размер" value={form.size} onChange={set("size")} />
            <Field label="Желаемый цвет" value={form.color} onChange={set("color")} />
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Количество" type="number" value={form.qty} onChange={set("qty")} />
            <Field label="Ваш бюджет (необязательно)" value={form.budget} onChange={set("budget")} />
          </div>
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Комментарий</label>
            <textarea value={form.comment} onChange={set("comment")} rows={2} className="w-full p-3 rounded-xl border border-line outline-none text-[14px] resize-none focus:border-accent bg-white" />
          </div>

          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Изображения (фото, рисунок, эскиз)</label>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} className="hidden" />
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-line text-[13.5px] text-stone hover:border-accent">
              <Camera size={17} /> Прикрепить изображение
            </button>
            {images.length > 0 && (
              <div className="flex gap-2 mt-2.5">
                {images.map((img, i) => <img key={i} src={img} alt="" className="w-16 h-16 rounded-lg object-cover" />)}
              </div>
            )}
          </div>

          <PrimaryButton full className="mt-2" onClick={submit}><Send size={16} /> Отправить заявку</PrimaryButton>
        </div>
      </div>
    </Section>
  );
}

/* =========================================================
   АКЦИИ
   ========================================================= */

function PromosPage({ openProduct }) {
  const { promos, products } = useShop();
  return (
    <Section className="pt-6 pb-16">
      <h1 className="font-display text-[28px] md:text-[34px] text-ink mb-6">🔥 Акции и специальные предложения</h1>
      {promos.length === 0 ? (
        <EmptyState icon={Tag} title="Сейчас нет активных акций" subtitle="Загляните позже — мы регулярно готовим предложения." />
      ) : (
        <div className="flex flex-col gap-8">
          {promos.map((promo) => {
            const promoProducts = products.filter((p) => promo.productIds.includes(p.id));
            return (
              <div key={promo.id}>
                <div className="rounded-[22px] overflow-hidden bg-white border border-line/70 mb-4">
                  <img src={promo.image} alt={promo.title} className="w-full h-44 object-cover" />
                  <div className="p-5">
                    <Badge tone="accent">−{promo.discount}%</Badge>
                    <div className="font-display text-[20px] text-ink mt-2">{promo.title}</div>
                    <p className="text-[14px] text-stone mt-1">{promo.description}</p>
                    <p className="text-[12.5px] text-stone mt-2">Действует до {formatDate(promo.endDate)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
                  {promoProducts.map((p) => <ProductCard key={p.id} product={p} onOpen={openProduct} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* =========================================================
   НОВОСТИ
   ========================================================= */

function NewsPage() {
  const { news } = useShop();
  return (
    <Section className="pt-6 pb-16">
      <h1 className="font-display text-[28px] md:text-[34px] text-ink mb-6">📰 Новости мастерской</h1>
      <div className="flex flex-col gap-4 max-w-2xl">
        {news.map((n) => (
          <div key={n.id} className="rounded-2xl bg-white border border-line/70 overflow-hidden">
            {n.image && <img src={n.image} alt={n.title} className="w-full h-44 object-cover" />}
            <div className="p-5">
              <div className="text-[12.5px] text-stone mb-1.5">{formatDate(n.date)}</div>
              <div className="font-display text-[19px] text-ink mb-1.5">{n.title}</div>
              <p className="text-[14.5px] text-stone leading-relaxed">{n.text}</p>
              {n.link && <a href={n.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13.5px] text-accent-dark font-medium mt-2">Подробнее <ArrowRight size={14} /></a>}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* =========================================================
   ОТЗЫВЫ
   ========================================================= */

function ReviewsPage() {
  const { reviews, products } = useShop();
  const approved = reviews.filter((r) => r.approved);
  return (
    <Section className="pt-6 pb-16">
      <h1 className="font-display text-[28px] md:text-[34px] text-ink mb-6">⭐ Отзывы покупателей</h1>
      {approved.length === 0 ? (
        <EmptyState icon={MessageSquare} title="Отзывов пока нет" subtitle="Станьте первым, кто оставит отзыв о своей покупке." />
      ) : (
        <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
          {approved.map((r) => {
            const product = products.find((p) => p.id === r.productId);
            return (
              <div key={r.id} className="p-5 rounded-2xl bg-white border border-line/70">
                <div className="flex items-center justify-between mb-2">
                  <Stars value={r.rating} />
                  <span className="text-[12px] text-stone">{formatDate(r.date)}</span>
                </div>
                <p className="text-[14.5px] text-ink leading-relaxed mb-3">«{r.text}»</p>
                <div className="flex items-center justify-between text-[13px] text-stone">
                  <span>— {r.userName}</span>
                  {product && <span className="italic">{product.name}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* =========================================================
   КОНТАКТЫ
   ========================================================= */

function ContactsBlock({ compact }) {
  return (
    <div className={`dark-surface rounded-[24px] bg-ink text-cream p-7 md:p-10 grid md:grid-cols-2 gap-6 ${compact ? "" : ""}`}>
      <div>
        <div className="text-[11px] tracking-[0.18em] uppercase text-accent mb-2">Мастерская «PlastMaster»</div>
        <h3 className="font-display text-[24px] mb-4">📞 Контакты</h3>
        <div className="flex flex-col gap-3 text-[14.5px] text-cream/85">
          <span className="flex items-center gap-2.5"><Phone size={16} /> +7 968 152-36-79</span>
          <span className="flex items-center gap-2.5"><MessageSquare size={16} /> WhatsApp: +7 968 152-36-79</span>
          <span className="flex items-center gap-2.5"><MapPin size={16} /> Якутск, Якутия</span>
          <span className="flex items-center gap-2.5"><Clock size={16} /> Пн–Сб, 10:00–19:00</span>
        </div>
      </div>
      <div className="flex flex-col gap-3 justify-center">
        <a href="tel:+79681523679"><PrimaryButton full className="!bg-accent hover:!bg-accent-dark"><Phone size={16} /> Позвонить</PrimaryButton></a>
        <a href="https://wa.me/79681523679" target="_blank" rel="noopener noreferrer"><SecondaryButton full className="!border-cream/30 !text-cream hover:!border-cream"><MessageSquare size={16} /> Написать в WhatsApp</SecondaryButton></a>
      </div>
    </div>
  );
}

function ContactsPage() {
  return <Section className="pt-6 pb-16"><h1 className="font-display text-[28px] md:text-[34px] text-ink mb-6">Контакты</h1><ContactsBlock /></Section>;
}

/* =========================================================
   ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ
   ========================================================= */

function PrivacyPage() {
  return (
    <Section className="pt-6 pb-16">
      <h1 className="font-display text-[26px] md:text-[32px] text-ink mb-2">Политика конфиденциальности</h1>
      <p className="text-[13px] text-stone mb-8">Действует с 28 августа 2026 года</p>

      <div className="max-w-2xl flex flex-col gap-6 text-[14.5px] text-ink/85 leading-relaxed">
        <div>
          <h2 className="font-display text-[18px] text-ink mb-2">1. Общие положения</h2>
          <p>Настоящая политика описывает, какие данные собирает сайт и приложение «PlastMaster» (далее — «сервис»), для чего они используются и как защищаются. Используя сервис, вы соглашаетесь с условиями этой политики.</p>
        </div>

        <div>
          <h2 className="font-display text-[18px] text-ink mb-2">2. Какие данные мы собираем</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>Имя, номер телефона и email — при регистрации аккаунта</li>
            <li>Адрес доставки, город, индекс — при оформлении заказа</li>
            <li>История и содержимое ваших заказов</li>
            <li>Текст отзывов, которые вы оставляете о товарах</li>
            <li>Изображения, которые вы прикладываете к заявке «Заказать своё изделие»</li>
          </ul>
          <p className="mt-2">Мы не собираем данные о геолокации, не запрашиваем доступ к контактам, камере, микрофону или платёжным данным — оплата согласовывается напрямую с владельцем мастерской вне сервиса (например, в WhatsApp).</p>
        </div>

        <div>
          <h2 className="font-display text-[18px] text-ink mb-2">3. Для чего используются данные</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>Оформление и обработка заказов</li>
            <li>Связь с вами по вопросам заказа (звонок, WhatsApp)</li>
            <li>Отображение истории заказов и статуса в личном кабинете</li>
            <li>Публикация отзывов после модерации</li>
          </ul>
        </div>

        <div>
          <h2 className="font-display text-[18px] text-ink mb-2">4. Хранение и защита данных</h2>
          <p>Данные хранятся на серверах сервиса Supabase с использованием защищённого соединения и правил разграничения доступа: каждый покупатель видит только свои заказы и данные, доступ ко всем заказам есть только у владельца мастерской.</p>
        </div>

        <div>
          <h2 className="font-display text-[18px] text-ink mb-2">5. Передача третьим лицам</h2>
          <p>Мы не продаём и не передаём ваши персональные данные третьим лицам, за исключением случаев, необходимых для выполнения заказа (например, службы доставки, если это применимо) или требований законодательства.</p>
        </div>

        <div>
          <h2 className="font-display text-[18px] text-ink mb-2">6. Ваши права</h2>
          <p>Вы можете запросить удаление своего аккаунта и связанных с ним данных, обратившись к владельцу мастерской через контакты, указанные на сайте.</p>
        </div>

        <div>
          <h2 className="font-display text-[18px] text-ink mb-2">7. Контакты</h2>
          <p>По вопросам, связанным с обработкой персональных данных, свяжитесь с нами по телефону +7 968 152-36-79 или через WhatsApp.</p>
        </div>
      </div>
    </Section>
  );
}

/* =========================================================
   АДМИН-ПАНЕЛЬ
   ========================================================= */

function AdminPage({ go }) {
  const { isAdmin, logout } = useShop();
  const [section, setSection] = useState("dashboard");

  if (!isAdmin) {
    return <Section className="pt-16 pb-16"><EmptyState icon={LayoutDashboard} title="Доступ только для администратора" subtitle="Войдите под учётной записью владельца мастерской." action={<PrimaryButton className="mt-5" onClick={() => go("auth")}>Войти</PrimaryButton>} /></Section>;
  }

  const menu = [
    { id: "dashboard", label: "Главная", icon: LayoutDashboard },
    { id: "orders", label: "Заказы", icon: Package },
    { id: "products", label: "Товары", icon: ImageIcon },
    { id: "categories", label: "Категории", icon: Grid3x3 },
    { id: "banner", label: "Баннер", icon: Sparkles },
    { id: "promocodes", label: "Промокоды", icon: Percent },
    { id: "users", label: "Пользователи", icon: Users },
    { id: "reviews", label: "Отзывы", icon: MessageSquare },
    { id: "promos", label: "Акции", icon: Tag },
    { id: "news", label: "Новости", icon: Newspaper },
    { id: "custom", label: "Заявки на заказ", icon: Sparkles },
  ];

  return (
    <Section className="pt-6 pb-32 md:pb-16">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-[11px] tracking-[0.18em] uppercase text-accent-dark mb-1">Панель управления</div>
          <h1 className="font-display text-[26px] md:text-[30px] text-ink">Добро пожаловать, владелец</h1>
        </div>
        <button onClick={() => { logout(); go("home"); }} className="flex items-center gap-1.5 text-[13.5px] text-stone hover:text-ink"><LogOut size={15} /> Выйти</button>
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-7 -mx-5 px-5 md:mx-0 md:px-0">
        {menu.map((m) => {
          const Icon = m.icon;
          return (
            <button key={m.id} onClick={() => setSection(m.id)} className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[13.5px] border ${section === m.id ? "bg-ink text-cream border-ink" : "border-line text-ink"}`}>
              <Icon size={14} /> {m.label}
            </button>
          );
        })}
      </div>

      {section === "dashboard" && <AdminDashboard />}
      {section === "orders" && <AdminOrders />}
      {section === "products" && <AdminProducts />}
      {section === "categories" && <AdminCategories />}
      {section === "banner" && <AdminBanner />}
      {section === "promocodes" && <AdminPromoCodes />}
      {section === "users" && <AdminUsers />}
      {section === "reviews" && <AdminReviews />}
      {section === "promos" && <AdminPromos />}
      {section === "news" && <AdminNews />}
      {section === "custom" && <AdminCustomRequests />}
    </Section>
  );
}

function AdminDashboard() {
  const { orders, products, users, customRequests } = useShop();
  const totalRevenue = orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.total, 0);
  const pendingOrders = orders.filter((o) => o.status === "new").length;
  const stats = [
    { label: "Всего заказов", value: orders.length, icon: Package },
    { label: "Ожидают подтверждения", value: pendingOrders, icon: Clock },
    { label: "Товаров в каталоге", value: products.length, icon: ImageIcon },
    { label: "Покупателей", value: users.length, icon: Users },
    { label: "Заявок «Заказать своё»", value: customRequests.length, icon: Sparkles },
    { label: "Выручка (не отменённые)", value: formatPrice(totalRevenue), icon: Star },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="p-4 rounded-2xl bg-white border border-line/70">
            <Icon size={17} className="text-accent-dark mb-2" />
            <div className="font-display text-[22px] text-ink">{s.value}</div>
            <div className="text-[12px] text-stone">{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function AdminOrders() {
  const { orders, updateOrderStatus } = useShop();
  const [expanded, setExpanded] = useState(null);
  if (orders.length === 0) return <EmptyState icon={Package} title="Заказов пока нет" />;
  return (
    <div className="flex flex-col gap-3">
      {orders.map((o) => {
        const st = STATUS_LABELS[o.status];
        const open = expanded === o.id;
        return (
          <div key={o.id} className="rounded-2xl bg-white border border-line/70 overflow-hidden">
            <button onClick={() => setExpanded(open ? null : o.id)} className="w-full flex items-center justify-between p-4 text-left">
              <div>
                <div className="text-[14.5px] font-medium text-ink">№{o.number} · {o.customerName}</div>
                <div className="text-[12.5px] text-stone">{formatDate(o.date)} · {formatPrice(o.total)}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={o.status === "cancelled" ? "stone" : "accent"}>{st.emoji} {st.label}</Badge>
                <ChevronDown size={16} className={`transition-transform text-stone ${open ? "rotate-180" : ""}`} />
              </div>
            </button>
            {open && (
              <div className="px-4 pb-4 border-t border-line/70 pt-3">
                <div className="grid sm:grid-cols-2 gap-3 text-[13.5px] mb-3">
                  <div><span className="text-stone">Телефон: </span><span className="text-ink">{o.phone}</span></div>
                  <div><span className="text-stone">Город: </span><span className="text-ink">{o.city}</span></div>
                  <div className="sm:col-span-2"><span className="text-stone">Адрес: </span><span className="text-ink">{o.address}{o.zip ? `, ${o.zip}` : ""}</span></div>
                  {o.comment && <div className="sm:col-span-2"><span className="text-stone">Комментарий: </span><span className="text-ink">{o.comment}</span></div>}
                  {o.promoCode && <div className="sm:col-span-2"><span className="text-stone">Промокод: </span><span className="text-sage-dark">{o.promoCode} (−{formatPrice(o.discountAmount || 0)})</span></div>}
                </div>
                <div className="flex flex-col gap-1 mb-3">
                  {o.items.map((it, i) => (
                    <div key={i} className="flex justify-between text-[13.5px]">
                      <span className="text-ink">{it.name}{it.color ? ` (${it.color})` : ""} × {it.qty}</span>
                      <span className="text-stone">{formatPrice(it.price * it.qty)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={o.status} onChange={(e) => updateOrderStatus(o.id, e.target.value)} className="px-3 py-2 rounded-full border border-line text-[13px] bg-white">
                    {[...STATUS_FLOW, "cancelled"].map((s) => <option key={s} value={s}>{STATUS_LABELS[s].emoji} {STATUS_LABELS[s].label}</option>)}
                  </select>
                  <a href={`tel:${o.phone}`} className="px-3.5 py-2 rounded-full border border-line text-[13px] flex items-center gap-1.5"><Phone size={13} /> Связаться с покупателем</a>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function emptyProductForm() {
  return { name: "", category: "keychains", price: "", inStock: true, qty: "", isNew: false, sale: "", images: [], video: "", description: "", sizes: "", material: "", colors: "", craftTime: "" };
}

function AdminProducts() {
  const { products, addProduct, updateProduct, deleteProduct, showToast, categories } = useShop();
  const [editing, setEditing] = useState(null); // null | "new" | product.id
  const [form, setForm] = useState(emptyProductForm());
  const fileRef = useRef(null);

  const startEdit = (p) => {
    setForm({ ...p, price: String(p.price), qty: String(p.qty), sale: p.sale ? String(p.sale) : "", colors: (p.colors || []).join(", "), video: p.video || "" });
    setEditing(p.id);
  };
  const startNew = () => { setForm(emptyProductForm()); setEditing("new"); };

  const [uploading, setUploading] = useState(false);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploadedUrls = [];
      for (const file of files) {
        const ext = file.name.split(".").pop();
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file);
        if (error) { showToast(`Не удалось загрузить ${file.name}: ${error.message}`); continue; }
        const { data } = supabase.storage.from("product-images").getPublicUrl(path);
        uploadedUrls.push(data.publicUrl);
      }
      setForm((f) => ({ ...f, images: [...f.images, ...uploadedUrls].slice(0, 6) }));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeImage = (idx) => {
    setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== idx) }));
  };

  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name || !form.price) return;
    const payload = {
      name: form.name, category: form.category, price: Number(form.price) || 0,
      inStock: form.inStock, qty: Number(form.qty) || 0, isNew: form.isNew,
      sale: form.sale ? Number(form.sale) : null,
      images: form.images.length ? form.images : [PLACEHOLDER_IMG(form.name || "Товар")],
      video: form.video || null,
      description: form.description, sizes: form.sizes, material: form.material,
      colors: form.colors ? form.colors.split(",").map((c) => c.trim()).filter(Boolean) : [],
      craftTime: form.craftTime,
    };
    setSaving(true);
    try {
      if (editing === "new") await addProduct(payload);
      else await updateProduct(editing, payload);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="max-w-xl">
        <h3 className="font-display text-[20px] text-ink mb-4">{editing === "new" ? "Добавить товар" : "Редактировать товар"}</h3>
        <div className="flex flex-col gap-3.5">
          <Field label="Название" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Категория</label>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="w-full p-3 rounded-xl border border-line bg-white text-[14px]">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Цена (₽)" type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
            <Field label="Скидка (%, необязательно)" type="number" value={form.sale} onChange={(e) => setForm((f) => ({ ...f, sale: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Количество на складе" type="number" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} />
            <Field label="Срок изготовления" value={form.craftTime} onChange={(e) => setForm((f) => ({ ...f, craftTime: e.target.value }))} placeholder="напр. 2–3 дня" />
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Размеры" value={form.sizes} onChange={(e) => setForm((f) => ({ ...f, sizes: e.target.value }))} />
            <Field label="Материал" value={form.material} onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))} />
          </div>
          <Field label="Доступные цвета (через запятую)" value={form.colors} onChange={(e) => setForm((f) => ({ ...f, colors: e.target.value }))} placeholder="Чёрный, Белый, Терракотовый" />
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Описание</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="w-full p-3 rounded-xl border border-line outline-none text-[14px] resize-none focus:border-accent bg-white" />
          </div>
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Фотографии (до 6 шт.)</label>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-line text-[13.5px] text-stone hover:border-accent disabled:opacity-50">
              <Upload size={16} /> {uploading ? "Загружаем…" : "Загрузить фото"}
            </button>
            {form.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {form.images.map((img, i) => (
                  <div key={i} className="relative">
                    <img src={img} className="w-16 h-16 rounded-lg object-cover" alt="" />
                    <button onClick={() => removeImage(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-cream flex items-center justify-center">
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Field label="Ссылка на видео (необязательно)" value={form.video} onChange={(e) => setForm((f) => ({ ...f, video: e.target.value }))} />
          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={form.inStock} onChange={(e) => setForm((f) => ({ ...f, inStock: e.target.checked }))} className="accent-accent w-4 h-4" /> В наличии</label>
            <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={form.isNew} onChange={(e) => setForm((f) => ({ ...f, isNew: e.target.checked }))} className="accent-accent w-4 h-4" /> Новинка</label>
          </div>
          <div className="flex gap-3 mt-2">
            <PrimaryButton onClick={save} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить"}</PrimaryButton>
            <SecondaryButton onClick={() => setEditing(null)}>Отмена</SecondaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PrimaryButton className="mb-5" onClick={startNew}><Plus size={16} /> Добавить товар</PrimaryButton>
      <div className="flex flex-col gap-2.5">
        {products.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-line/70">
            <img src={p.images[0]} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[14px] text-ink line-clamp-1">{p.name}</div>
              <div className="text-[12.5px] text-stone">{formatPrice(salePrice(p))} · {p.inStock ? `в наличии: ${p.qty}` : "нет в наличии"}</div>
            </div>
            <button onClick={() => startEdit(p)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-line/60 text-stone shrink-0"><Edit2 size={15} /></button>
            <button onClick={() => deleteProduct(p.id)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-line/60 text-red-500 shrink-0"><Trash size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   АДМИН: КАТЕГОРИИ
   ========================================================= */

function AdminCategories() {
  const { categories, addCategory, updateCategory, deleteCategory } = useShop();
  const [editing, setEditing] = useState(null); // null | "new" | slug
  const [form, setForm] = useState({ name: "", emoji: "📦" });
  const [saving, setSaving] = useState(false);

  const startEdit = (c) => { setForm({ name: c.name, emoji: c.emoji }); setEditing(c.id); };
  const startNew = () => { setForm({ name: "", emoji: "📦" }); setEditing("new"); };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing === "new") await addCategory(form.name.trim(), form.emoji.trim() || "📦");
      else await updateCategory(editing, { name: form.name.trim(), emoji: form.emoji.trim() || "📦" });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="max-w-md">
        <h3 className="font-display text-[20px] text-ink mb-4">{editing === "new" ? "Добавить категорию" : "Редактировать категорию"}</h3>
        <div className="flex flex-col gap-3.5">
          <Field label="Название" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Например: Свечи" />
          <Field label="Эмодзи-иконка" value={form.emoji} onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))} placeholder="🕯️" />
          <p className="text-[12.5px] text-stone">Скопируйте любой эмодзи из клавиатуры телефона (обычно значок 😀 рядом с полем ввода) и вставьте сюда.</p>
          <div className="flex gap-3 mt-2">
            <PrimaryButton onClick={save} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить"}</PrimaryButton>
            <SecondaryButton onClick={() => setEditing(null)}>Отмена</SecondaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PrimaryButton className="mb-5" onClick={startNew}><Plus size={16} /> Добавить категорию</PrimaryButton>
      {categories.length === 0 ? (
        <EmptyState icon={Grid3x3} title="Категорий пока нет" subtitle="Добавьте первую категорию, чтобы она появилась на сайте." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-line/70">
              <span className="text-2xl w-10 text-center">{c.emoji}</span>
              <div className="flex-1 text-[14px] text-ink">{c.name}</div>
              <button onClick={() => startEdit(c)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-line/60 text-stone shrink-0"><Edit2 size={15} /></button>
              <button onClick={() => deleteCategory(c.id)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-line/60 text-red-500 shrink-0"><Trash size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   АДМИН: БАННЕР ГЛАВНОЙ СТРАНИЦЫ
   ========================================================= */

function emptySlideForm() {
  return { title: "", text: "", image: "", ctaText: "Подробнее", ctaPage: "catalog", active: true };
}

const SLIDE_TARGET_PAGES = [
  { id: "catalog", label: "Каталог" },
  { id: "promos", label: "Акции" },
  { id: "custom", label: "Заказать своё" },
  { id: "news", label: "Новости" },
  { id: "reviews", label: "Отзывы" },
  { id: "contacts", label: "Контакты" },
];

function AdminBanner() {
  const { allHeroSlides, addHeroSlide, updateHeroSlide, deleteHeroSlide, showToast } = useShop();
  const [editing, setEditing] = useState(null); // null | "new" | slide.id
  const [form, setForm] = useState(emptySlideForm());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const startEdit = (s) => { setForm({ title: s.title, text: s.text || "", image: s.image || "", ctaText: s.ctaText, ctaPage: s.ctaPage, active: s.active }); setEditing(s.id); };
  const startNew = () => { setForm(emptySlideForm()); setEditing("new"); };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `banners/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file);
      if (error) { showToast("Не удалось загрузить фото: " + error.message); return; }
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      setForm((f) => ({ ...f, image: data.publicUrl }));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (editing === "new") await addHeroSlide(form);
      else await updateHeroSlide(editing, form);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="max-w-lg">
        <h3 className="font-display text-[20px] text-ink mb-4">{editing === "new" ? "Добавить слайд" : "Редактировать слайд"}</h3>
        <div className="flex flex-col gap-3.5">
          <Field label="Заголовок" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Например: Скидки на подарки" />
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Текст под заголовком (необязательно)</label>
            <textarea value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} rows={2} className="w-full p-3 rounded-xl border border-line outline-none text-[14px] resize-none focus:border-accent bg-white" />
          </div>
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Фото слайда</label>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-line text-[13.5px] text-stone hover:border-accent disabled:opacity-50">
              <Upload size={16} /> {uploading ? "Загружаем…" : "Загрузить фото"}
            </button>
            {form.image && (
              <div className="relative w-full mt-2.5">
                <img src={form.image} className="w-full h-32 object-cover rounded-xl" alt="" />
                <button onClick={() => setForm((f) => ({ ...f, image: "" }))} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-ink text-cream flex items-center justify-center"><X size={13} /></button>
              </div>
            )}
          </div>
          <Field label="Текст на кнопке" value={form.ctaText} onChange={(e) => setForm((f) => ({ ...f, ctaText: e.target.value }))} placeholder="Например: Смотреть акции" />
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Куда ведёт кнопка</label>
            <select value={form.ctaPage} onChange={(e) => setForm((f) => ({ ...f, ctaPage: e.target.value }))} className="w-full p-3 rounded-xl border border-line bg-white text-[14px]">
              {SLIDE_TARGET_PAGES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} className="accent-accent w-4 h-4" /> Показывать на сайте
          </label>
          <div className="flex gap-3 mt-2">
            <PrimaryButton onClick={save} disabled={saving || uploading}>{saving ? "Сохраняем…" : "Сохранить"}</PrimaryButton>
            <SecondaryButton onClick={() => setEditing(null)}>Отмена</SecondaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13.5px] text-stone mb-4">Слайды показываются на главной странице по очереди. Можно добавить сколько угодно.</p>
      <PrimaryButton className="mb-5" onClick={startNew}><Plus size={16} /> Добавить слайд</PrimaryButton>
      {allHeroSlides.length === 0 ? (
        <EmptyState icon={Sparkles} title="Слайдов пока нет" subtitle="Добавьте первый слайд для баннера на главной." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {allHeroSlides.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-line/70">
              {s.image ? <img src={s.image} className="w-16 h-12 rounded-lg object-cover shrink-0" alt="" /> : <div className="w-16 h-12 rounded-lg bg-line/40 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-ink line-clamp-1">{s.title}</div>
                <div className="text-[12px] text-stone">{s.active ? "Показывается" : "Скрыт"} · кнопка «{s.ctaText}»</div>
              </div>
              <button onClick={() => startEdit(s)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-line/60 text-stone shrink-0"><Edit2 size={15} /></button>
              <button onClick={() => deleteHeroSlide(s.id)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-line/60 text-red-500 shrink-0"><Trash size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   АДМИН: ПРОМОКОДЫ
   ========================================================= */

function emptyPromoCodeForm() {
  return { code: "", discountPercent: "10", maxUses: "", expiresAt: "" };
}

function AdminPromoCodes() {
  const { promoCodes, addPromoCode, togglePromoCodeActive, deletePromoCode, showToast } = useShop();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyPromoCodeForm());
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.code.trim() || !form.discountPercent) { showToast("Заполните код и размер скидки"); return; }
    setSaving(true);
    try {
      await addPromoCode(form);
      setForm(emptyPromoCodeForm());
      setCreating(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {creating ? (
        <div className="max-w-md mb-6 p-4 rounded-2xl bg-white border border-line/70">
          <div className="text-[14px] font-medium text-ink mb-3">Новый промокод</div>
          <div className="flex flex-col gap-3">
            <Field label="Код (например, SUMMER10)" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
            <Field label="Скидка, %" type="number" value={form.discountPercent} onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Лимит использований (необязательно)" type="number" value={form.maxUses} onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} />
              <div>
                <label className="text-[13px] text-stone mb-1.5 block">Действует до (необязательно)</label>
                <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} className="w-full p-3 rounded-xl border border-line outline-none text-[14px] bg-white" />
              </div>
            </div>
            <div className="flex gap-3">
              <PrimaryButton onClick={save} disabled={saving}>{saving ? "Создаём…" : "Создать"}</PrimaryButton>
              <SecondaryButton onClick={() => setCreating(false)}>Отмена</SecondaryButton>
            </div>
          </div>
        </div>
      ) : (
        <PrimaryButton className="mb-5" onClick={() => setCreating(true)}><Plus size={16} /> Добавить промокод</PrimaryButton>
      )}

      {promoCodes.length === 0 ? (
        <EmptyState icon={Percent} title="Промокодов пока нет" subtitle="Создайте код для акции — покупатели будут вводить его при оформлении заказа." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {promoCodes.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-3.5 rounded-2xl bg-white border border-line/70">
              <div className="flex-1 min-w-0">
                <div className="text-[14.5px] font-mono font-medium text-ink">{c.code}</div>
                <div className="text-[12px] text-stone">
                  Скидка {c.discountPercent}% · использован {c.usedCount}{c.maxUses ? ` из ${c.maxUses}` : " раз"}
                  {c.expiresAt ? ` · до ${formatDate(c.expiresAt)}` : ""}
                </div>
              </div>
              <button onClick={() => togglePromoCodeActive(c.id, !c.active)} className={`px-3 py-1.5 rounded-full text-[12px] font-medium shrink-0 ${c.active ? "bg-sage/15 text-sage-dark" : "bg-line/60 text-stone"}`}>
                {c.active ? "Активен" : "Выключен"}
              </button>
              <button onClick={() => deletePromoCode(c.id)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-line/60 text-red-500 shrink-0"><Trash size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminUsers() {
  const { users, orders } = useShop();
  if (users.length === 0) return <EmptyState icon={Users} title="Пока нет зарегистрированных покупателей" />;
  return (
    <div className="flex flex-col gap-2.5">
      {users.map((u) => {
        const userOrders = orders.filter((o) => o.userId === u.id);
        return (
          <div key={u.id} className="p-4 rounded-2xl bg-white border border-line/70">
            <div className="flex items-center justify-between">
              <div className="text-[14.5px] font-medium text-ink">{u.name}</div>
              <span className="text-[12.5px] text-stone">{userOrders.length} заказ(ов)</span>
            </div>
            <div className="text-[13px] text-stone mt-1">{u.email} · {u.phone}</div>
          </div>
        );
      })}
    </div>
  );
}

function AdminReviews() {
  const { reviews, moderateReview, products } = useShop();
  const pending = reviews.filter((r) => !r.approved);
  const approved = reviews.filter((r) => r.approved);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="font-display text-[18px] text-ink mb-3">На модерации ({pending.length})</h3>
        {pending.length === 0 ? <p className="text-[13.5px] text-stone">Нет отзывов на модерации.</p> : (
          <div className="flex flex-col gap-2.5">
            {pending.map((r) => (
              <div key={r.id} className="p-4 rounded-2xl bg-white border border-line/70">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[14px] font-medium text-ink">{r.userName}</span>
                  <Stars value={r.rating} size={13} />
                </div>
                <p className="text-[13.5px] text-ink/85 mb-1">«{r.text}»</p>
                <p className="text-[12px] text-stone mb-3">{products.find((p) => p.id === r.productId)?.name}</p>
                <div className="flex gap-2">
                  <SecondaryButton className="!py-1.5 !px-3.5 !text-[13px]" onClick={() => moderateReview(r.id, true)}>Опубликовать</SecondaryButton>
                  <button onClick={() => moderateReview(r.id, false)} className="!py-1.5 px-3.5 text-[13px] text-red-500 rounded-full border border-line">Отклонить</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="font-display text-[18px] text-ink mb-3">Опубликованные ({approved.length})</h3>
        <div className="flex flex-col gap-2.5">
          {approved.map((r) => (
            <div key={r.id} className="p-3.5 rounded-2xl bg-white border border-line/70 flex items-center justify-between">
              <div>
                <span className="text-[13.5px] font-medium text-ink">{r.userName}</span>
                <span className="text-[12.5px] text-stone ml-2">«{r.text.slice(0, 40)}{r.text.length > 40 ? "…" : ""}»</span>
              </div>
              <button onClick={() => moderateReview(r.id, false)} className="text-stone hover:text-red-500"><Trash size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function emptyPromoForm() {
  return { title: "", description: "", image: "", discount: "", endDate: "" };
}

function AdminPromos() {
  const { promos, addPromo, updatePromo, deletePromo, showToast } = useShop();
  const [editing, setEditing] = useState(null); // null | "new" | promo.id
  const [form, setForm] = useState(emptyPromoForm());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const startEdit = (p) => { setForm({ title: p.title, description: p.description || "", image: p.image || "", discount: p.discount ? String(p.discount) : "", endDate: p.endDate ? String(p.endDate).slice(0, 10) : "" }); setEditing(p.id); };
  const startNew = () => { setForm(emptyPromoForm()); setEditing("new"); };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `promos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file);
      if (error) { showToast("Не удалось загрузить фото: " + error.message); return; }
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      setForm((f) => ({ ...f, image: data.publicUrl }));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (editing === "new") await addPromo(form);
      else await updatePromo(editing, form);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="max-w-lg">
        <h3 className="font-display text-[20px] text-ink mb-4">{editing === "new" ? "Добавить акцию" : "Редактировать акцию"}</h3>
        <div className="flex flex-col gap-3.5">
          <Field label="Заголовок" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Например: Скидка на подарочные наборы" />
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Описание</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="w-full p-3 rounded-xl border border-line outline-none text-[14px] resize-none focus:border-accent bg-white" />
          </div>
          <div>
            <label className="text-[13px] text-stone mb-1.5 block">Картинка</label>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-line text-[13.5px] text-stone hover:border-accent disabled:opacity-50">
              <Upload size={16} /> {uploading ? "Загружаем…" : "Загрузить фото"}
            </button>
            {form.image && (
              <div className="relative w-full mt-2.5">
                <img src={form.image} className="w-full h-32 object-cover rounded-xl" alt="" />
                <button onClick={() => setForm((f) => ({ ...f, image: "" }))} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-ink text-cream flex items-center justify-center"><X size={13} /></button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Скидка, % (необязательно)" type="number" value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))} />
            <div>
              <label className="text-[13px] text-stone mb-1.5 block">Действует до (необязательно)</label>
              <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className="w-full p-3 rounded-xl border border-line outline-none text-[14px] bg-white" />
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <PrimaryButton onClick={save} disabled={saving || uploading}>{saving ? "Сохраняем…" : "Сохранить"}</PrimaryButton>
            <SecondaryButton onClick={() => setEditing(null)}>Отмена</SecondaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PrimaryButton className="mb-5" onClick={startNew}><Plus size={16} /> Добавить акцию</PrimaryButton>
      {promos.length === 0 ? (
        <EmptyState icon={Tag} title="Акций пока нет" subtitle="Добавьте первую акцию — она появится на главной и странице «Акции»." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {promos.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-line/70">
              {p.image ? <img src={p.image} className="w-16 h-12 rounded-lg object-cover shrink-0" alt="" /> : <div className="w-16 h-12 rounded-lg bg-line/40 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-ink line-clamp-1">{p.title}</div>
                <div className="text-[12px] text-stone">{p.discount ? `Скидка ${p.discount}%` : "Без скидки"}{p.endDate ? ` · до ${formatDate(p.endDate)}` : ""}</div>
              </div>
              <button onClick={() => startEdit(p)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-line/60 text-stone shrink-0"><Edit2 size={15} /></button>
              <button onClick={() => deletePromo(p.id)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-line/60 text-red-500 shrink-0"><Trash size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function emptyNewsForm() {
  return { title: "", text: "", image: "", link: "" };
}

function AdminNews() {
  const { news, addNews, deleteNews, showToast } = useShop();
  const [editing, setEditing] = useState(null); // null | "new"
  const [form, setForm] = useState(emptyNewsForm());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const startNew = () => { setForm(emptyNewsForm()); setEditing("new"); };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `news/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file);
      if (error) { showToast("Не удалось загрузить фото: " + error.message); return; }
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      setForm((f) => ({ ...f, image: data.publicUrl }));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const save = async () => {
    if (!form.title.trim() || !form.text.trim()) return;
    setSaving(true);
    try {
      await addNews({ title: form.title.trim(), text: form.text.trim(), image: form.image || null, link: form.link.trim() || null });
      setEditing(null);
      setForm(emptyNewsForm());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {editing === "new" ? (
        <div className="max-w-lg mb-6 p-4 rounded-2xl bg-white border border-line/70">
          <div className="text-[14px] font-medium text-ink mb-3">Новая новость</div>
          <div className="flex flex-col gap-3">
            <Field label="Заголовок" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            <textarea value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} placeholder="Текст новости" rows={3} className="w-full p-3 rounded-xl border border-line outline-none text-[14px] resize-none focus:border-accent" />
            <div>
              <label className="text-[13px] text-stone mb-1.5 block">Картинка (необязательно)</label>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-line text-[13.5px] text-stone hover:border-accent disabled:opacity-50">
                <Upload size={16} /> {uploading ? "Загружаем…" : "Загрузить фото"}
              </button>
              {form.image && (
                <div className="relative w-full mt-2.5">
                  <img src={form.image} className="w-full h-32 object-cover rounded-xl" alt="" />
                  <button onClick={() => setForm((f) => ({ ...f, image: "" }))} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-ink text-cream flex items-center justify-center"><X size={13} /></button>
                </div>
              )}
            </div>
            <Field label="Ссылка (необязательно)" value={form.link} onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))} placeholder="https://..." />
            <div className="flex gap-3">
              <PrimaryButton onClick={save} disabled={saving || uploading}>{saving ? "Публикуем…" : "Опубликовать"}</PrimaryButton>
              <SecondaryButton onClick={() => setEditing(null)}>Отмена</SecondaryButton>
            </div>
          </div>
        </div>
      ) : (
        <PrimaryButton className="mb-5" onClick={startNew}><Plus size={16} /> Добавить новость</PrimaryButton>
      )}
      <div className="flex flex-col gap-2.5">
        {news.map((n) => (
          <div key={n.id} className="p-3.5 rounded-2xl bg-white border border-line/70 flex items-center gap-3">
            {n.image ? <img src={n.image} className="w-14 h-14 rounded-lg object-cover shrink-0" alt="" /> : null}
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-ink line-clamp-1">{n.title}</div>
              <div className="text-[12px] text-stone">{formatDate(n.date)}{n.link ? " · со ссылкой" : ""}</div>
            </div>
            <button onClick={() => deleteNews(n.id)} className="text-stone hover:text-red-500 shrink-0"><Trash size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminCustomRequests() {
  const { customRequests } = useShop();
  if (customRequests.length === 0) return <EmptyState icon={Sparkles} title="Заявок пока нет" subtitle="Заявки с формы «Заказать своё изделие» появятся здесь." />;
  return (
    <div className="flex flex-col gap-2.5">
      {customRequests.map((r) => (
        <div key={r.id} className="p-4 rounded-2xl bg-white border border-line/70">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[14.5px] font-medium text-ink">{r.name}</span>
            <span className="text-[12px] text-stone">{formatDate(r.date)}</span>
          </div>
          <p className="text-[13.5px] text-ink/85 mb-2">{r.description}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-stone">
            {r.size && <span>Размер: {r.size}</span>}
            {r.color && <span>Цвет: {r.color}</span>}
            {r.qty && <span>Кол-во: {r.qty}</span>}
            {r.budget && <span>Бюджет: {r.budget}</span>}
            <span>Тел: {r.phone}</span>
          </div>
        </div>
      ))}
    </div>
  );
}


/* =========================================================
   ГЛАВНЫЙ КОМПОНЕНТ
   ========================================================= */

function AppShell() {
  const { ready, toast } = useShop();
  const [page, setPage] = useState("home");
  const [pageParams, setPageParams] = useState({});
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);

  const go = useCallback((p, params = {}) => {
    if (p === "product" && params.product) {
      setSelectedProduct(params.product);
      setPage("product");
    } else {
      setPage(p);
      setPageParams(params);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const openProduct = useCallback((product) => {
    setSelectedProduct(product);
    setPage("product");
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <Logo size={44} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream text-ink font-body flex flex-col">
      <Header page={page} go={go} search={search} setSearch={setSearch} />
      <main className="flex-1">
        {page === "home" && <HomePage go={go} openProduct={openProduct} />}
        {page === "catalog" && <CatalogPage openProduct={openProduct} initialFilter={pageParams} search={search} setSearch={setSearch} />}
        {page === "product" && selectedProduct && <ProductPage product={selectedProduct} go={go} back={() => go("catalog")} />}
        {page === "favorites" && <FavoritesPage openProduct={openProduct} go={go} />}
        {page === "cart" && <CartPage go={go} />}
        {page === "checkout" && <CheckoutPage go={go} />}
        {page === "auth" && <AuthPage go={go} redirectTo={pageParams.redirectTo} />}
        {page === "account" && <AccountPage go={go} initialTab={pageParams.tab} />}
        {page === "admin" && <AdminPage go={go} />}
        {page === "custom" && <CustomOrderPage />}
        {page === "promos" && <PromosPage openProduct={openProduct} />}
        {page === "news" && <NewsPage />}
        {page === "reviews" && <ReviewsPage />}
        {page === "contacts" && <ContactsPage />}
        {page === "privacy" && <PrivacyPage />}
      </main>
      <Footer go={go} />
      <BottomNav page={page} go={go} />
      <Toast text={toast} />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ShopProvider>
        <AppShell />
      </ShopProvider>
    </ThemeProvider>
  );
}
