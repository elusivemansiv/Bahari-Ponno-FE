/**
 * Bahari Ponno — API Client
 * Connects the UI BP frontend to the Django REST backend.
 * All pages import this via <script src="api.js"></script>
 */

const API_BASE = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' 
    ? 'http://127.0.0.1:8000/api' 
    : 'https://bahari-ponno-be-production.up.railway.app/api';

// ─── Token Helpers ────────────────────────────────────────────────────────────
const Auth = {
    getAccess:  () => localStorage.getItem('bp_access'),
    getRefresh: () => localStorage.getItem('bp_refresh'),
    getUser:    () => { try { return JSON.parse(localStorage.getItem('bp_user')); } catch { return null; } },
    isLoggedIn: () => !!localStorage.getItem('bp_access'),

    save(access, refresh, user) {
        localStorage.setItem('bp_access', access);
        if (refresh) localStorage.setItem('bp_refresh', refresh);
        if (user)    localStorage.setItem('bp_user', JSON.stringify(user));
    },

    clear() {
        localStorage.removeItem('bp_access');
        localStorage.removeItem('bp_refresh');
        localStorage.removeItem('bp_user');
    },
};

// ─── HTTP Core ─────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = Auth.getAccess();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

    // Try to refresh token once on 401
    if (res.status === 401 && Auth.getRefresh()) {
        const refreshRes = await fetch(`${API_BASE}/users/login/refresh/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh: Auth.getRefresh() }),
        });
        if (refreshRes.ok) {
            const data = await refreshRes.json();
            Auth.save(data.access, null, null);
            headers['Authorization'] = `Bearer ${data.access}`;
            res = await fetch(`${API_BASE}${path}`, { ...options, headers });
        } else {
            Auth.clear();
            window.location.href = 'auth.html';
            return;
        }
    }

    if (!res.ok) {
        let errBody;
        try { errBody = await res.json(); } catch { errBody = { detail: res.statusText }; }
        throw { status: res.status, data: errBody };
    }

    try { return await res.json(); } catch { return null; }
}

// ─── Auth API ─────────────────────────────────────────────────────────────────
const UserAPI = {
    async login(email, password) {
        const data = await apiFetch('/users/login/', {
            method: 'POST',
            body: JSON.stringify({ username: email, password }),
        });
        Auth.save(data.access, data.refresh, null);
        // Fetch profile immediately
        const profile = await UserAPI.profile();
        Auth.save(data.access, data.refresh, profile);
        return profile;
    },

    async register({ username, email, phone, password }) {
        return apiFetch('/users/register/', {
            method: 'POST',
            body: JSON.stringify({ username, email, phone, password, role: 'CUSTOMER' }),
        });
    },

    async profile() {
        return apiFetch('/users/profile/');
    },

    async updateProfile(data) {
        return apiFetch('/users/profile/', { method: 'PATCH', body: JSON.stringify(data) });
    },

    logout() {
        Auth.clear();
        window.location.href = 'auth.html';
    },
};

// ─── Products API ──────────────────────────────────────────────────────────────
const ProductAPI = {
    list() {
        return apiFetch('/products/products/');
    },
    get(id) {
        return apiFetch(`/products/products/${id}/`);
    },
    variants() {
        return apiFetch('/products/variants/');
    },
};

// ─── Orders API ────────────────────────────────────────────────────────────────
const OrderAPI = {
    /** 
     * @param {Object} orderData - { items: [{product_variant_id, quantity}], payment: {payment_type} }
     */
    create(orderData) {
        return apiFetch('/orders/', {
            method: 'POST',
            body: JSON.stringify(orderData),
        });
    },
    list() {
        return apiFetch('/orders/');
    },
    get(id) {
        return apiFetch(`/orders/${id}/`);
    },
};

// ─── Deliveries API ─────────────────────────────────────────────────────────────
const DeliveryAPI = {
    list() {
        return apiFetch('/deliveries/');
    },
};

// ─── Cart (localStorage) ───────────────────────────────────────────────────────
const Cart = {
    _key: 'bp_cart',

    get() {
        try { return JSON.parse(localStorage.getItem(this._key)) || []; } catch { return []; }
    },

    save(items) {
        localStorage.setItem(this._key, JSON.stringify(items));
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: items }));
    },

    /**
     * @param {Object} item - { variantId, productId, name, amount, price, image }
     */
    addItem(item, qty = 1) {
        const items = this.get();
        const existing = items.find(i => i.variantId === item.variantId);
        if (existing) {
            existing.quantity += qty;
        } else {
            items.push({ ...item, quantity: qty });
        }
        this.save(items);
        return items;
    },

    removeItem(variantId) {
        const items = this.get().filter(i => i.variantId !== variantId);
        this.save(items);
        return items;
    },

    updateQty(variantId, qty) {
        const items = this.get().map(i => i.variantId === variantId ? { ...i, quantity: qty } : i)
                                .filter(i => i.quantity > 0);
        this.save(items);
        return items;
    },

    clear() {
        localStorage.removeItem(this._key);
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: [] }));
    },

    total() {
        return this.get().reduce((sum, i) => sum + (parseFloat(i.price) * i.quantity), 0);
    },

    count() {
        return this.get().reduce((sum, i) => sum + i.quantity, 0);
    },
};

// ─── UI Helpers ─────────────────────────────────────────────────────────────────

/** Updates every element with class "cart-badge" with the current cart count */
function syncCartBadge() {
    const count = Cart.count();
    document.querySelectorAll('.cart-badge').forEach(el => {
        el.textContent = count;
        el.style.display = count > 0 ? '' : 'none';
    });
}

/** Shows a toast notification */
function showToast(message, sub = '', type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const msgEl  = toast.querySelector('.toast-msg');
    const subEl  = toast.querySelector('.toast-sub');
    if (msgEl) msgEl.textContent = message;
    if (subEl) subEl.textContent = sub;
    toast.classList.replace('translate-y-24', 'translate-y-0');
    toast.classList.replace('opacity-0', 'opacity-100');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.replace('translate-y-0', 'translate-y-24');
        toast.classList.replace('opacity-100', 'opacity-0');
    }, 3000);
}

/** Updates the nav to show the logged-in user's name or Login link */
function syncNavAuth() {
    const user = Auth.getUser();
    const loginLinks = document.querySelectorAll('.nav-login-link');
    const userMenus  = document.querySelectorAll('.nav-user-menu');
    const userNames  = document.querySelectorAll('.nav-user-name');

    if (user) {
        loginLinks.forEach(el => el.classList.add('hidden'));
        userMenus.forEach(el => el.classList.remove('hidden'));
        userNames.forEach(el => el.textContent = user.username || user.email);
    } else {
        loginLinks.forEach(el => el.classList.remove('hidden'));
        userMenus.forEach(el => el.classList.add('hidden'));
    }
}

/** 
 * Formats a number as Bangladeshi Taka 
 * @param {number} amount
 */
function formatTaka(amount) {
    return '৳' + parseFloat(amount).toLocaleString('en-BD');
}

// Run on every page load
document.addEventListener('DOMContentLoaded', () => {
    syncCartBadge();
    syncNavAuth();
    document.addEventListener('cart:updated', syncCartBadge);
});
