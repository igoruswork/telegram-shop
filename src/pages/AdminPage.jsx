import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  createProduct,
  deleteAccessLogEntry,
  deleteLoveCareActivityEvents,
  fetchAdminOrders,
  fetchAccessLogEntries,
  fetchAllProducts,
  fetchCatalogUsers,
  fetchLoveCareActivity,
  fetchProductImageSource,
  importProductImage,
  updateProduct,
  updateCatalogUserApproval,
  updateCatalogUserName,
  uploadProductImageFile,
} from '../lib/supabase';
import { isPhoneComplete, normalizePhoneInput } from '../lib/phone';
import { SafeImage } from '../components/SafeImage';

const emptyProductForm = {
  id: '',
  name: '',
  sku: '',
  price: '',
  thumbnail_url: '',
  category: '',
  p_category: '',
};

const brandColorPresets = [
  '#075985', '#0284c7', '#0ea5e9', '#06b6d4', '#14b8a6',
  '#10b981', '#22c55e', '#84cc16', '#eab308', '#f59e0b',
  '#f97316', '#ea580c', '#ef4444', '#e11d48', '#be123c',
  '#db2777', '#c026d3', '#9333ea', '#7c3aed', '#4f46e5',
  '#2563eb', '#1d4ed8', '#334155', '#111827',
];

const adminSections = [
  { id: 'title', label: 'Заголовок' },
  { id: 'create', label: 'Нова картка' },
  { id: 'colors', label: 'Кольори' },
  { id: 'details', label: 'Деталі картки' },
  { id: 'visibility', label: 'Видимість' },
  { id: 'access', label: 'Користувачі' },
  { id: 'access-log', label: 'Журнал входів' },
  { id: 'lovecare', label: 'LoveCare' },
  { id: 'orders', label: 'Замовлення' },
];

const DEFAULT_ADMIN_SECTION = 'details';
const accessTabs = [
  { id: 'all', label: 'Користувачі' },
  { id: 'approved', label: 'Схвалено' },
  { id: 'pending', label: 'Очікує' },
];

function normalizeAdminSection(section) {
  return adminSections.some((item) => item.id === section) ? section : DEFAULT_ADMIN_SECTION;
}

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '');
}

function formatKyivDateTime(value) {
  if (!value) return '';

  try {
    const formatted = new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Kyiv',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));

    return `${formatted} Київ`;
  } catch {
    return '';
  }
}

function formatPrice(value) {
  return Number(value || 0).toLocaleString('uk-UA');
}

function normalizeOrderItems(items) {
  if (Array.isArray(items)) return items;

  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function cleanActivityText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return !text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined'
    ? fallback
    : text;
}

function loveCareSessionKey(entry) {
  if (entry.session_id) return entry.session_id;

  // Early LoveCare entries did not have a session_id. Group those records by
  // phone and entry minute so the existing history appears as one session.
  const phone = cleanActivityText(entry.phone, 'unknown');
  const date = new Date(entry.created_at || 0);
  const minute = Number.isNaN(date.getTime())
    ? String(entry.id || 'unknown')
    : date.toISOString().slice(0, 16);

  return `legacy-${phone}-${minute}`;
}

export function AdminPage({
  onBack,
  brandColors = {},
  onBrandColorChange,
  defaultBrandColor,
  catalogTitle,
  onCatalogTitleChange,
  defaultCatalogTitle,
  paymentDetails,
  paymentIban,
  paymentCardColor,
  paymentTaxId,
  paymentExtraDetails,
  paymentCardVisibility,
  onPaymentDetailsChange,
  onPaymentIbanChange,
  onPaymentCardColorChange,
  onPaymentTaxIdChange,
  onPaymentExtraDetailsChange,
  onPaymentCardVisibilityChange,
  initialSection = DEFAULT_ADMIN_SECTION,
  adminPhones = [],
  onAdminPhonesChange,
  currentAdminPhone = '',
}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Всі');
  const [activeSubCategory, setActiveSubCategory] = useState('Всі');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState({});
  const [saved, setSaved] = useState({});
  const [activeSection, setActiveSection] = useState(() => normalizeAdminSection(initialSection));
  const [newProduct, setNewProduct] = useState(emptyProductForm);
  const [creating, setCreating] = useState(false);
  const [createSaved, setCreateSaved] = useState(false);
  const [imageReloading, setImageReloading] = useState({});
  const [imageReloaded, setImageReloaded] = useState({});
  const [imageUploading, setImageUploading] = useState({});
  const [newProductImageFile, setNewProductImageFile] = useState(null);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [catalogTitleDraft, setCatalogTitleDraft] = useState(catalogTitle);
  const [paymentCardColorDraft, setPaymentCardColorDraft] = useState(paymentCardColor);
  const [catalogUsers, setCatalogUsers] = useState([]);
  const [accessSearch, setAccessSearch] = useState('');
  const [accessTab, setAccessTab] = useState('all');
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [editingCatalogUserPhone, setEditingCatalogUserPhone] = useState('');
  const [catalogUserNameDraft, setCatalogUserNameDraft] = useState('');
  const [savingCatalogUserName, setSavingCatalogUserName] = useState(false);
  const [accessLogs, setAccessLogs] = useState([]);
  const [accessLogsLoading, setAccessLogsLoading] = useState(false);
  const [accessLogsError, setAccessLogsError] = useState('');
  const [deletingAccessLogIds, setDeletingAccessLogIds] = useState({});
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [loveCareActivity, setLoveCareActivity] = useState([]);
  const [loveCareLoading, setLoveCareLoading] = useState(false);
  const [loveCareError, setLoveCareError] = useState('');
  const [loveCareSearch, setLoveCareSearch] = useState('');
  const [deletingLoveCareSessionIds, setDeletingLoveCareSessionIds] = useState({});
  const [confirmingLoveCareSessionId, setConfirmingLoveCareSessionId] = useState('');
  const [adminPhoneDraft, setAdminPhoneDraft] = useState('');
  const [adminPhoneError, setAdminPhoneError] = useState('');
  const [adminPhoneSaved, setAdminPhoneSaved] = useState(false);
  const hasLoadedProductsRef = useRef(false);
  const selectedBrandColor = selectedBrand
    ? (brandColors[selectedBrand] || defaultBrandColor)
    : defaultBrandColor;
  const [brandColorDraft, setBrandColorDraft] = useState(selectedBrandColor);
  const normalizedAdminPhones = useMemo(
    () => [...new Set((adminPhones || []).map(normalizePhoneInput).filter(isPhoneComplete))],
    [adminPhones]
  );
  const normalizedCurrentAdminPhone = normalizePhoneInput(currentAdminPhone);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAllProducts();
      setProducts(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setActiveSection(normalizeAdminSection(initialSection));
  }, [initialSection]);

  const loadCatalogUsers = useCallback(async () => {
    setAccessLoading(true);
    setAccessError('');

    try {
      const data = await fetchCatalogUsers();
      setCatalogUsers(data);
    } catch (e) {
      setCatalogUsers([]);
      setAccessError(e.message);
    } finally {
      setAccessLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError('');

    try {
      const data = await fetchAdminOrders();
      setOrders(data);
    } catch (e) {
      setOrders([]);
      setOrdersError(e.message);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  const loadAccessLogs = useCallback(async () => {
    setAccessLogsLoading(true);
    setAccessLogsError('');

    try {
      const data = await fetchAccessLogEntries();
      setAccessLogs(data);
    } catch (e) {
      setAccessLogs([]);
      setAccessLogsError(e.message);
    } finally {
      setAccessLogsLoading(false);
    }
  }, []);

  const loadLoveCareActivity = useCallback(async () => {
    setLoveCareLoading(true);
    setLoveCareError('');

    try {
      const data = await fetchLoveCareActivity();
      setLoveCareActivity(data);
    } catch (error) {
      setLoveCareActivity([]);
      setLoveCareError(error.message || 'Не вдалося завантажити реакції LoveCare.');
    } finally {
      setLoveCareLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === 'access') {
      loadCatalogUsers();
    }

    if (activeSection === 'access-log') {
      loadAccessLogs();
    }

    if (activeSection === 'orders') {
      loadOrders();
    }

    if (activeSection === 'lovecare') {
      loadLoveCareActivity();
    }
  }, [activeSection, loadAccessLogs, loadCatalogUsers, loadLoveCareActivity, loadOrders]);

  useEffect(() => {
    const sectionNeedsProducts = ['details', 'visibility', 'create', 'colors'].includes(activeSection);
    if (sectionNeedsProducts && !hasLoadedProductsRef.current) {
      hasLoadedProductsRef.current = true;
      load();
    }
  }, [activeSection, load]);

  useEffect(() => {
    setBrandColorDraft(selectedBrandColor);
  }, [selectedBrandColor]);

  useEffect(() => {
    setCatalogTitleDraft(catalogTitle);
  }, [catalogTitle]);

  useEffect(() => {
    setPaymentCardColorDraft(paymentCardColor);
  }, [paymentCardColor]);

  const allCategories = useMemo(() => {
    const unique = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
    return ['Всі', ...unique];
  }, [products]);

  const categoryOptions = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products]
  );

  const filteredCatalogUsers = useMemo(() => {
    const query = accessSearch.trim().toLocaleLowerCase('uk-UA');

    return catalogUsers.filter((entry) => {
      if (accessTab === 'approved' && !entry.is_approved) return false;
      if (accessTab === 'pending' && entry.is_approved) return false;
      if (!query) return true;

      return [entry.last_name, entry.phone, entry.tg_user_id]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('uk-UA').includes(query));
    });
  }, [accessSearch, accessTab, catalogUsers]);

  const loveCareSessions = useMemo(() => {
    const sessions = new Map();

    loveCareActivity
      .filter((entry) => entry.type === 'session_open')
      .forEach((entry) => {
        const id = loveCareSessionKey(entry);
        const current = sessions.get(id);
        if (current) return;

        sessions.set(id, { id, opened: entry, closed: null, reactions: [], eventIds: [entry.id] });
      });

    loveCareActivity
      .filter((entry) => entry.type !== 'session_open')
      .forEach((entry) => {
        const id = loveCareSessionKey(entry);
        let session = sessions.get(id);

        if (!session) {
          session = {
            id,
            opened: entry,
            closed: null,
            reactions: [],
            eventIds: [],
          };
          sessions.set(id, session);
        }

        if (entry.id) session.eventIds.push(entry.id);

        if (entry.type === 'session_close') {
          session.closed = entry;
        } else if (entry.type === 'product_reaction') {
          session.reactions.push(entry);
        }
      });

    return [...sessions.values()]
      .map((session) => ({
        ...session,
        reactions: session.reactions.sort((left, right) => (
          new Date(right.created_at || 0) - new Date(left.created_at || 0)
        )),
      }))
      .sort((left, right) => new Date(right.opened?.created_at || 0) - new Date(left.opened?.created_at || 0));
  }, [loveCareActivity]);

  const filteredLoveCareSessions = useMemo(() => {
    const query = loveCareSearch.trim().toLocaleLowerCase('uk-UA');
    if (!query) return loveCareSessions;

    return loveCareSessions.filter((session) => [
      session.opened?.last_name,
      session.opened?.phone,
      session.opened?.tg_user_id,
      ...session.reactions.flatMap((entry) => [
        entry.product_name,
        entry.product_sku,
        entry.product_category,
        entry.reaction,
      ]),
    ].filter(Boolean).some((value) => String(value).toLocaleLowerCase('uk-UA').includes(query)));
  }, [loveCareSearch, loveCareSessions]);

  const handleDeleteLoveCareSession = async (session) => {
    if (deletingLoveCareSessionIds[session.id]) return;

    const eventIds = session.eventIds.filter(Boolean);
    if (eventIds.length === 0) {
      alert('Не вдалося визначити записи для видалення. Оновіть сторінку та спробуйте ще раз.');
      return;
    }

    const previousActivity = loveCareActivity;
    const idsToDelete = new Set(eventIds);
    setLoveCareError('');
    setDeletingLoveCareSessionIds((current) => ({ ...current, [session.id]: true }));
    setLoveCareActivity((current) => current.filter((entry) => !idsToDelete.has(entry.id)));

    try {
      await deleteLoveCareActivityEvents(eventIds);
    } catch (error) {
      setLoveCareActivity(previousActivity);
      setLoveCareError(error.message || 'Не вдалося видалити вхід LoveCare.');
    } finally {
      setConfirmingLoveCareSessionId((current) => (current === session.id ? '' : current));
      setDeletingLoveCareSessionIds((current) => {
        const next = { ...current };
        delete next[session.id];
        return next;
      });
    }
  };

  useEffect(() => {
    if (categoryOptions.length === 0) {
      setSelectedBrand('');
      return;
    }

    if (!selectedBrand || !categoryOptions.includes(selectedBrand)) {
      setSelectedBrand(categoryOptions[0]);
    }
  }, [categoryOptions, selectedBrand]);

  const subCategoryOptions = useMemo(() => {
    const source = newProduct.category
      ? products.filter((p) => p.category === newProduct.category)
      : products;

    return [...new Set(source.map((p) => p.p_category).filter(Boolean))].sort();
  }, [products, newProduct.category]);

  const subCategories = useMemo(() => {
    if (activeCategory === 'Всі') return [];
    const unique = [...new Set(
      products.filter((p) => p.category === activeCategory).map((p) => p.p_category).filter(Boolean)
    )].sort();
    return unique.length ? ['Всі', ...unique] : [];
  }, [products, activeCategory]);

  const handleCategoryClick = (cat) => {
    setActiveCategory(cat);
    setActiveSubCategory('Всі');
  };

  const filtered = useMemo(() => {
    let result = products;
    if (search.trim()) {
      const words = search.toLowerCase().trim().split(/\s+/);
      result = result.filter((p) => {
        const hay = `${p.name || ''} ${p.category || ''} ${p.p_category || ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    } else {
      if (activeCategory !== 'Всі') result = result.filter((p) => p.category === activeCategory);
      if (activeCategory !== 'Всі' && activeSubCategory !== 'Всі')
        result = result.filter((p) => p.p_category === activeSubCategory);
    }
    return result;
  }, [products, search, activeCategory, activeSubCategory]);

  const getEdit = (p) => ({
    p_category: edits[p.id]?.p_category ?? (p.p_category || ''),
    badge: edits[p.id]?.badge ?? (p.badge || ''),
    category: edits[p.id]?.category ?? (p.category || ''),
    price: edits[p.id]?.price ?? String(p.price ?? ''),
    number_sites: edits[p.id]?.number_sites ?? String(p.number_sites ?? ''),
  });

  const isDirty = (p) => {
    const e = edits[p.id];
    if (!e) return false;
    return (
      (e.p_category !== undefined && e.p_category !== (p.p_category || '')) ||
      (e.badge !== undefined && e.badge !== (p.badge || '')) ||
      (e.category !== undefined && e.category !== (p.category || '')) ||
      (e.price !== undefined && e.price !== String(p.price ?? '')) ||
      (e.number_sites !== undefined && e.number_sites !== String(p.number_sites ?? ''))
    );
  };

  const handleField = (id, field, value) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setSaved((prev) => ({ ...prev, [id]: false }));
  };

  const handleNewProductField = (field, value) => {
    setNewProduct((prev) => ({ ...prev, [field]: value }));
    setCreateSaved(false);
  };

  const handleBrandColorInput = (value) => {
    setBrandColorDraft(value);
    if (selectedBrand && isHexColor(value)) {
      onBrandColorChange(selectedBrand, value);
    }
  };

  const handleBrandColorChange = (value) => {
    setBrandColorDraft(value);
    if (selectedBrand) {
      onBrandColorChange(selectedBrand, value);
    }
  };

  const handleCatalogTitleInput = (value) => {
    setCatalogTitleDraft(value);
    onCatalogTitleChange(value.trim() || defaultCatalogTitle);
  };

  const handlePaymentCardColorInput = (value) => {
    setPaymentCardColorDraft(value);
    if (isHexColor(value)) {
      onPaymentCardColorChange?.(value);
    }
  };

  const handleAdminPhoneInput = (value) => {
    setAdminPhoneDraft(normalizePhoneInput(value));
    setAdminPhoneError('');
    setAdminPhoneSaved(false);
  };

  const handleAddAdminPhone = () => {
    const phone = normalizePhoneInput(adminPhoneDraft);

    if (!isPhoneComplete(phone)) {
      setAdminPhoneError('Введіть номер у форматі +380XXXXXXXXX.');
      setAdminPhoneSaved(false);
      return;
    }

    if (normalizedAdminPhones.includes(phone)) {
      setAdminPhoneError('Цей номер вже є у списку.');
      setAdminPhoneSaved(false);
      return;
    }

    onAdminPhonesChange?.([...normalizedAdminPhones, phone]);
    setAdminPhoneDraft('');
    setAdminPhoneError('');
    setAdminPhoneSaved(true);
    window.setTimeout(() => setAdminPhoneSaved(false), 1500);
  };

  const handleRemoveAdminPhone = (phone) => {
    const nextPhones = normalizedAdminPhones.filter((item) => item !== phone);
    onAdminPhonesChange?.(nextPhones);
    setAdminPhoneError('');
    setAdminPhoneSaved(true);
    window.setTimeout(() => setAdminPhoneSaved(false), 1500);
  };

  const handleRefresh = () => {
    if (activeSection === 'access') {
      loadCatalogUsers();
      return;
    }

    if (activeSection === 'access-log') {
      loadAccessLogs();
      return;
    }

    if (activeSection === 'orders') {
      loadOrders();
      return;
    }

    if (activeSection === 'lovecare') {
      loadLoveCareActivity();
      return;
    }

    load();
  };

  const handleCatalogUserApproval = async (catalogUser, isApproved) => {
    const previous = catalogUser.is_approved;
    setCatalogUsers((current) => current.map((item) => (
      item.phone === catalogUser.phone ? { ...item, is_approved: isApproved } : item
    )));

    try {
      const updated = await updateCatalogUserApproval(catalogUser.phone, isApproved);
      setCatalogUsers((current) => current.map((item) => (
        item.phone === updated.phone ? updated : item
      )));
    } catch (error) {
      setCatalogUsers((current) => current.map((item) => (
        item.phone === catalogUser.phone ? { ...item, is_approved: previous } : item
      )));
      alert('Помилка: ' + error.message);
    }
  };

  const startCatalogUserNameEdit = (catalogUser) => {
    setEditingCatalogUserPhone(catalogUser.phone);
    setCatalogUserNameDraft(catalogUser.last_name || '');
  };

  const cancelCatalogUserNameEdit = () => {
    setEditingCatalogUserPhone('');
    setCatalogUserNameDraft('');
  };

  const saveCatalogUserName = async (catalogUser) => {
    const lastName = catalogUserNameDraft.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!lastName) {
      alert('Введіть ім’я користувача.');
      return;
    }

    setSavingCatalogUserName(true);
    try {
      const updated = await updateCatalogUserName(catalogUser.phone, lastName);
      setCatalogUsers((current) => current.map((item) => (
        item.phone === updated.phone ? updated : item
      )));
      cancelCatalogUserNameEdit();
    } catch (error) {
      alert('Помилка: ' + error.message);
    } finally {
      setSavingCatalogUserName(false);
    }
  };

  const handleDeleteAccessLog = async (entry) => {
    if (deletingAccessLogIds[entry.id]) return;

    setDeletingAccessLogIds((current) => ({ ...current, [entry.id]: true }));
    setAccessLogs((current) => current.filter((item) => item.id !== entry.id));

    try {
      await deleteAccessLogEntry(entry.id);
    } catch (error) {
      setAccessLogs((current) => [...current, entry].sort((left, right) => (
        new Date(right.created_at) - new Date(left.created_at)
      )));
      alert('Помилка: ' + error.message);
    } finally {
      setDeletingAccessLogIds((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
    }
  };

  const handleToggleView = async (p) => {
    setSaving((prev) => ({ ...prev, [p.id]: true }));
    try {
      await updateProduct(p.id, { view: !p.view });
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, view: !x.view } : x)));
    } catch (e) {
      alert('Помилка: ' + e.message);
    } finally {
      setSaving((prev) => ({ ...prev, [p.id]: false }));
    }
  };

  const handleSave = async (p) => {
    const e = edits[p.id] || {};
    const fields = {};
    if (e.p_category !== undefined) fields.p_category = e.p_category || null;
    if (e.badge !== undefined) fields.badge = e.badge || null;
    if (e.category !== undefined) fields.category = e.category || null;
    if (e.price !== undefined) fields.price = e.price === '' ? null : Number(e.price);
    if (e.number_sites !== undefined) fields.number_sites = e.number_sites === '' ? null : Number(e.number_sites);
    if (!Object.keys(fields).length) return;

    setSaving((prev) => ({ ...prev, [p.id]: true }));
    try {
      await updateProduct(p.id, fields);
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...fields } : x)));
      setEdits((prev) => { const next = { ...prev }; delete next[p.id]; return next; });
      setSaved((prev) => ({ ...prev, [p.id]: true }));
      setTimeout(() => setSaved((prev) => ({ ...prev, [p.id]: false })), 1500);
    } catch (e) {
      alert('Помилка: ' + e.message);
    } finally {
      setSaving((prev) => ({ ...prev, [p.id]: false }));
    }
  };

  const handleReloadImage = async (p) => {
    if (imageReloading[p.id]) return;

    setImageReloading((prev) => ({ ...prev, [p.id]: true }));
    setImageReloaded((prev) => ({ ...prev, [p.id]: false }));

    try {
      const sourceUrl = await fetchProductImageSource(p);

      if (!sourceUrl) {
        alert('У товару немає URL картинки для повторного завантаження.');
        return;
      }

      const imported = await importProductImage({
        productId: p.id,
        sourceUrl,
        sku: p.sku,
        name: p.name,
      });

      if (!imported?.product?.thumbnail_url) {
        throw new Error('Функція не повернула оновлений thumbnail_url.');
      }

      setProducts((prev) => prev.map((x) => (
        x.id === p.id
          ? {
              ...x,
              ...imported.product,
              source_thumbnail_url: imported.source_thumbnail_url || sourceUrl,
              image_storage_path: imported.image_storage_path,
              image_status: 'ok',
            }
          : x
      )));
      setImageReloaded((prev) => ({ ...prev, [p.id]: true }));
      setTimeout(() => {
        setImageReloaded((prev) => ({ ...prev, [p.id]: false }));
      }, 1800);
    } catch (e) {
      alert('Помилка оновлення фото: ' + e.message);
    } finally {
      setImageReloading((prev) => ({ ...prev, [p.id]: false }));
    }
  };

  const handleUploadImageFile = async (p, file) => {
    if (!file || imageUploading[p.id]) return;

    setImageUploading((prev) => ({ ...prev, [p.id]: true }));
    setImageReloaded((prev) => ({ ...prev, [p.id]: false }));

    try {
      const uploaded = await uploadProductImageFile({
        productId: p.id,
        file,
        sku: p.sku,
        name: p.name,
        sourceUrl: p.source_thumbnail_url || p.thumbnail_url,
      });

      if (!uploaded?.product?.thumbnail_url) {
        throw new Error('Storage не повернув оновлений thumbnail_url.');
      }

      setProducts((prev) => prev.map((x) => (
        x.id === p.id
          ? {
              ...x,
              ...uploaded.product,
              source_thumbnail_url: uploaded.source_thumbnail_url,
              image_storage_path: uploaded.image_storage_path,
              image_status: 'ok',
            }
          : x
      )));
      setImageReloaded((prev) => ({ ...prev, [p.id]: true }));
      setTimeout(() => {
        setImageReloaded((prev) => ({ ...prev, [p.id]: false }));
      }, 1800);
    } catch (e) {
      alert('Помилка завантаження фото: ' + e.message);
    } finally {
      setImageUploading((prev) => ({ ...prev, [p.id]: false }));
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (creating) return;

    const id = Number(newProduct.id);
    const price = Number(newProduct.price);

    if (!Number.isInteger(id) || id <= 0) {
      alert('Вкажіть коректний id.');
      return;
    }

    if (!newProduct.name.trim()) {
      alert('Вкажіть name.');
      return;
    }

    if (!newProduct.sku.trim()) {
      alert('Вкажіть sku.');
      return;
    }

    if (!newProduct.price.trim() || !Number.isFinite(price)) {
      alert('Вкажіть коректну price.');
      return;
    }

    if (!newProduct.thumbnail_url.trim() && !newProductImageFile) {
      alert('Вкажіть thumbnail_url або оберіть файл фото.');
      return;
    }

    if (!newProduct.category.trim()) {
      alert('Вкажіть category.');
      return;
    }

    if (!newProduct.p_category.trim()) {
      alert('Вкажіть p_category.');
      return;
    }

    const maxOrder = products.reduce((max, p) => {
      const order = Number(p.number_sites);
      return Number.isFinite(order) ? Math.max(max, order) : max;
    }, 0);

    const payload = {
      id,
      name: newProduct.name.trim(),
      sku: newProduct.sku.trim(),
      price,
      thumbnail_url: newProduct.thumbnail_url.trim(),
      category: newProduct.category.trim(),
      p_category: newProduct.p_category.trim(),
      badge: null,
      view: true,
      number_sites: maxOrder + 1,
    };

    setCreating(true);
    try {
      let created = await createProduct(payload);

      if (newProductImageFile) {
        try {
          const uploaded = await uploadProductImageFile({
            productId: created.id,
            file: newProductImageFile,
            sku: created.sku,
            name: created.name,
            sourceUrl: payload.thumbnail_url || '',
          });

          if (uploaded?.product?.thumbnail_url) {
            created = { ...created, ...uploaded.product };
          }
        } catch (imageError) {
          console.warn('Product file upload skipped:', imageError);
          alert('Товар створено, але файл фото не завантажився: ' + imageError.message);
        }
      } else if (payload.thumbnail_url) {
        try {
          const imported = await importProductImage({
            productId: created.id,
            sourceUrl: payload.thumbnail_url,
            sku: created.sku,
            name: created.name,
          });

          if (imported?.product?.thumbnail_url) {
            created = { ...created, ...imported.product };
          }
        } catch (imageError) {
          console.warn('Product image import skipped:', imageError);
        }
      }

      setProducts((prev) => [...prev, created].sort((a, b) => {
        const aOrder = Number(a.number_sites ?? 0);
        const bOrder = Number(b.number_sites ?? 0);
        return aOrder - bOrder;
      }));
      setNewProduct(emptyProductForm);
      setNewProductImageFile(null);
      setCreateSaved(true);
      setTimeout(() => setCreateSaved(false), 1500);
    } catch (err) {
      alert('Помилка: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const isProductSection = activeSection === 'details' || activeSection === 'visibility';

  return (
    <div className="admin-page">
      <div className="header">
        <div className="header-row">
          <button type="button" className="admin-back-btn" onClick={onBack}>
            ← Назад
          </button>
          <div className="header-title">Адмін</div>
          <div className="admin-header-actions">
            <button
              type="button"
              className="admin-add-btn"
              aria-label="Нова картка"
              onClick={() => setActiveSection('create')}
            >
              +
            </button>
            <button type="button" className="admin-refresh-btn" onClick={handleRefresh}>↻</button>
          </div>
        </div>
        {isProductSection && (
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search-input"
            type="text"
            inputMode="search"
            placeholder="Пошук товарів…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="search-clear" onClick={() => setSearch('')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        )}
      </div>

      <div className="admin-section-tabs" role="tablist" aria-label="Розділи адмінки">
        {adminSections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`admin-section-tab ${activeSection === section.id ? 'active' : ''}`}
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>

      {activeSection === 'title' && (
        <div className="admin-settings-card admin-section-card">
          <div className="admin-create-head">
            <div className="admin-create-title">Зміна заголовку</div>
          </div>

          <label className="admin-label admin-title-label">
            <span>title</span>
            <input
              className="admin-input"
              type="text"
              value={catalogTitleDraft}
              placeholder={defaultCatalogTitle}
              onChange={(e) => handleCatalogTitleInput(e.target.value)}
              maxLength={28}
            />
          </label>
        </div>
      )}

      {activeSection === 'title' && (
        <div className="admin-settings-card admin-section-card">
          <div className="admin-create-head">
            <div>
              <div className="admin-create-title">Картка реквізитів</div>
              <div className="admin-settings-subtitle">
                На мобільному вона розміщується першою зліва над товарами.
              </div>
            </div>
          </div>

          <label className="admin-label admin-label--stacked">
            <span>Текст</span>
            <textarea
              className="admin-input admin-settings-textarea"
              value={paymentDetails}
              placeholder="ФОП Прізвище Ім’я"
              onChange={(event) => onPaymentDetailsChange?.(event.target.value)}
              maxLength={180}
              rows={3}
            />
          </label>
          <label className="admin-label admin-label--stacked">
            <span>IBAN</span>
            <input
              className="admin-input"
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              value={paymentIban}
              placeholder="UA123456789012345678901234567"
              onChange={(event) => onPaymentIbanChange?.(event.target.value)}
              maxLength={42}
            />
          </label>
          <label className="admin-label admin-label--stacked">
            <span>ІПН/ЄДРПОУ</span>
            <input
              className="admin-input"
              type="text"
              inputMode="numeric"
              value={paymentTaxId}
              placeholder="3830010811"
              onChange={(event) => onPaymentTaxIdChange?.(event.target.value)}
              maxLength={16}
            />
          </label>
          <label className="admin-label admin-label--stacked">
            <span>Додатково</span>
            <textarea
              className="admin-input admin-settings-textarea"
              value={paymentExtraDetails}
              placeholder="Банк, призначення платежу або інші реквізити"
              onChange={(event) => onPaymentExtraDetailsChange?.(event.target.value)}
              maxLength={280}
              rows={3}
            />
          </label>
          <label className="admin-label admin-label--stacked">
            <span>Колір картки</span>
            <div className="admin-payment-color-row">
              <input
                className="admin-payment-color-picker"
                type="color"
                value={isHexColor(paymentCardColorDraft) ? paymentCardColorDraft : paymentCardColor}
                aria-label="Колір картки реквізитів"
                onChange={(event) => handlePaymentCardColorInput(event.target.value)}
              />
              <input
                className="admin-input"
                type="text"
                value={paymentCardColorDraft}
                maxLength={7}
                onChange={(event) => handlePaymentCardColorInput(event.target.value)}
                placeholder="#B8A477"
              />
            </div>
          </label>
          <div className="admin-payment-visibility" role="group" aria-label="Видимість реквізитів">
            <div className="admin-settings-subtitle">Що показувати покупцеві</div>
            {[
              ['enabled', 'Показувати картку'],
              ['name', 'ПІБ / назву'],
              ['iban', 'IBAN'],
              ['taxId', 'ІПН / ЄДРПОУ'],
              ['extraDetails', 'Додаткову інформацію'],
            ].map(([key, label]) => (
              <label key={key} className="admin-payment-visibility-row">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(paymentCardVisibility?.[key])}
                  onChange={(event) => onPaymentCardVisibilityChange?.(key, event.target.checked)}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {activeSection === 'title' && (
        <div className="admin-settings-card admin-section-card">
          <div className="admin-create-head">
            <div>
              <div className="admin-create-title">Адміни</div>
              <div className="admin-settings-subtitle">Номери, які можуть відкривати адмін-панель.</div>
            </div>
            {adminPhoneSaved && <span className="admin-saved-badge">✓ Збережено</span>}
          </div>

          <div className="admin-phone-add-row">
            <input
              className="admin-input"
              type="tel"
              inputMode="numeric"
              value={adminPhoneDraft}
              placeholder="+380502847652"
              onChange={(e) => handleAdminPhoneInput(e.target.value)}
              maxLength={13}
            />
            <button
              type="button"
              className="admin-save-btn admin-phone-add-btn"
              onClick={handleAddAdminPhone}
            >
              Додати
            </button>
          </div>

          {adminPhoneError && <div className="admin-phone-error">{adminPhoneError}</div>}

          <div className="admin-phone-list">
            {normalizedAdminPhones.map((phone) => {
              const isCurrent = phone === normalizedCurrentAdminPhone;

              return (
                <div key={phone} className="admin-phone-item">
                  <div>
                    <div className="admin-phone-number">{phone}</div>
                    {isCurrent && <div className="admin-phone-note">ваш номер</div>}
                  </div>
                  <button
                    type="button"
                    className="admin-phone-remove"
                    disabled={isCurrent || normalizedAdminPhones.length <= 1}
                    onClick={() => handleRemoveAdminPhone(phone)}
                    aria-label={`Прибрати ${phone} з адміністраторів`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeSection === 'create' && (
        <form className="admin-create-card" onSubmit={handleCreateProduct}>
          <div className="admin-create-head">
            <div>
              <div className="admin-create-title">Нова картка</div>
            </div>
            {createSaved && <span className="admin-saved-badge">✓ Створено</span>}
          </div>

          <div className="admin-create-grid">
            <label className="admin-label">
              <span>id</span>
              <input className="admin-input" type="number" inputMode="numeric" value={newProduct.id} placeholder="id"
                onChange={(e) => handleNewProductField('id', e.target.value)} />
            </label>
            <label className="admin-label">
              <span>name</span>
              <input className="admin-input" type="text" value={newProduct.name} placeholder="назва товару"
                onChange={(e) => handleNewProductField('name', e.target.value)} />
            </label>
            <label className="admin-label">
              <span>sku</span>
              <input className="admin-input" type="text" inputMode="numeric" value={newProduct.sku} placeholder="штрихкод"
                onChange={(e) => handleNewProductField('sku', e.target.value)} />
            </label>
            <label className="admin-label">
              <span>price</span>
              <input className="admin-input" type="number" inputMode="decimal" step="0.01" value={newProduct.price} placeholder="ціна"
                onChange={(e) => handleNewProductField('price', e.target.value)} />
            </label>
            <label className="admin-label">
              <span>category</span>
              <input className="admin-input" type="text" list="admin-category-options" value={newProduct.category} placeholder="оберіть або введіть"
                onChange={(e) => handleNewProductField('category', e.target.value)} />
            </label>
            <label className="admin-label">
              <span>p_category</span>
              <input className="admin-input" type="text" list="admin-subcategory-options" value={newProduct.p_category} placeholder="оберіть або введіть"
                onChange={(e) => handleNewProductField('p_category', e.target.value)} />
            </label>
            <label className="admin-label admin-label--wide">
              <span>thumbnail</span>
              <input className="admin-input" type="url" value={newProduct.thumbnail_url} placeholder="https://..."
                onChange={(e) => handleNewProductField('thumbnail_url', e.target.value)} />
            </label>
            <label className="admin-label admin-label--wide">
              <span>photo_file</span>
              <input
                className="admin-input admin-file-input"
                type="file"
                accept="image/*"
                onChange={(e) => setNewProductImageFile(e.target.files?.[0] || null)}
              />
            </label>
            {newProductImageFile && (
              <div className="admin-file-name">
                {newProductImageFile.name}
              </div>
            )}
          </div>

          <datalist id="admin-category-options">
            {categoryOptions.map((category) => <option key={category} value={category} />)}
          </datalist>
          <datalist id="admin-subcategory-options">
            {subCategoryOptions.map((subCategory) => <option key={subCategory} value={subCategory} />)}
          </datalist>

          <button type="submit" className="admin-save-btn admin-create-submit" disabled={creating}>
            {creating ? 'Створення…' : 'Додати товар'}
          </button>
        </form>
      )}

      {activeSection === 'colors' && (
      <div className="admin-settings-card admin-section-card">
        <div className="admin-create-head">
          <div>
            <div className="admin-create-title">Налаштування кольорів</div>
          </div>
        </div>

        <label className="admin-label admin-brand-select-label">
          <span>brand</span>
          <select
            className="admin-input admin-brand-select"
            value={selectedBrand}
            onChange={(e) => setSelectedBrand(e.target.value)}
            disabled={categoryOptions.length === 0}
          >
            {categoryOptions.length === 0 ? (
              <option value="">Немає брендів</option>
            ) : (
              categoryOptions.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))
            )}
          </select>
        </label>

        <div className="admin-brand-row">
          <label className="admin-brand-picker">
            <input
              type="color"
              value={selectedBrandColor}
              onChange={(e) => handleBrandColorChange(e.target.value)}
              aria-label="Колір бренду"
              disabled={!selectedBrand}
            />
            <span style={{ background: selectedBrandColor }} />
          </label>
          <input
            className="admin-input admin-brand-hex"
            type="text"
            value={brandColorDraft}
            maxLength={7}
            onChange={(e) => handleBrandColorInput(e.target.value)}
            placeholder="#075985"
          />
          <button
            type="button"
            className="admin-reset-btn"
            onClick={() => handleBrandColorChange(defaultBrandColor)}
            disabled={!selectedBrand}
          >
            Скинути
          </button>
        </div>

        <div className="admin-brand-presets">
          {brandColorPresets.map((color) => (
            <button
              key={color}
              type="button"
              className={`admin-brand-swatch ${selectedBrandColor.toLowerCase() === color ? 'active' : ''}`}
              style={{ background: color }}
              aria-label={`Обрати колір ${color}`}
              onClick={() => handleBrandColorChange(color)}
              disabled={!selectedBrand}
            />
          ))}
        </div>
      </div>
      )}

      {activeSection === 'access' && (
        <>
          <div className="admin-access-toolbar">
            <div className="admin-access-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                inputMode="search"
                value={accessSearch}
                placeholder="Пошук за ПІБ, телефоном або TG ID"
                onChange={(event) => setAccessSearch(event.target.value)}
              />
              {accessSearch && (
                <button type="button" aria-label="Очистити пошук" onClick={() => setAccessSearch('')}>×</button>
              )}
            </div>
            <div className="admin-access-tabs" role="tablist" aria-label="Статус користувачів">
              {accessTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={accessTab === tab.id}
                  className={accessTab === tab.id ? 'active' : ''}
                  onClick={() => setAccessTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="admin-activity-list">
          {accessLoading && <div className="admin-activity-loading">Завантаження…</div>}
          {accessError && <div className="admin-activity-error">{accessError}</div>}
          {!accessLoading && !accessError && filteredCatalogUsers.map((entry) => (
            <article
              key={entry.phone}
              className={`admin-access-card ${entry.is_approved ? 'admin-access-card--approved' : 'admin-access-card--pending'}`}
            >
              <div className="admin-access-person">
                {editingCatalogUserPhone === entry.phone ? (
                  <div className="admin-user-name-editor">
                    <input
                      className="admin-input"
                      type="text"
                      value={catalogUserNameDraft}
                      onChange={(event) => setCatalogUserNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') saveCatalogUserName(entry);
                        if (event.key === 'Escape') cancelCatalogUserNameEdit();
                      }}
                      maxLength={120}
                      autoFocus
                      aria-label="Ім’я користувача"
                    />
                    <button type="button" className="admin-user-name-save" disabled={savingCatalogUserName} onClick={() => saveCatalogUserName(entry)}>
                      {savingCatalogUserName ? '…' : 'Зберегти'}
                    </button>
                    <button type="button" className="admin-user-name-cancel" disabled={savingCatalogUserName} onClick={cancelCatalogUserNameEdit} aria-label="Скасувати редагування">×</button>
                  </div>
                ) : (
                  <div className="admin-access-name-row">
                    <div className="admin-access-name">{entry.last_name || 'Без імені'}</div>
                    <button type="button" className="admin-user-name-edit" onClick={() => startCatalogUserNameEdit(entry)} aria-label={`Редагувати ім’я ${entry.last_name || 'користувача'}`}>✎</button>
                  </div>
                )}
                <div className="admin-access-phone">{entry.phone || 'Без телефону'}</div>
              </div>
              <div className="admin-access-meta">
                {entry.tg_user_id && <span>TG {entry.tg_user_id}</span>}
                <time dateTime={entry.last_access_at}>{formatKyivDateTime(entry.last_access_at)}</time>
                <label className="admin-user-approval">
                  <input
                    type="checkbox"
                    checked={Boolean(entry.is_approved)}
                    onChange={(event) => handleCatalogUserApproval(entry, event.target.checked)}
                  />
                  <span>{entry.is_approved ? 'Схвалено' : 'Очікує схвалення'}</span>
                </label>
              </div>
            </article>
          ))}
          {!accessLoading && !accessError && filteredCatalogUsers.length === 0 && (
            <div className="admin-activity-loading">Користувачів не знайдено</div>
          )}
          </div>
        </>
      )}

      {activeSection === 'access-log' && (
        <div className="admin-activity-list admin-access-log-list">
          {accessLogsLoading && <div className="admin-activity-loading">Завантаження…</div>}
          {accessLogsError && <div className="admin-activity-error">{accessLogsError}</div>}
          {!accessLogsLoading && !accessLogsError && accessLogs.map((entry) => (
            <article key={entry.id} className="admin-access-card admin-access-card--log">
              <div className="admin-access-person">
                <div className="admin-access-name">{entry.last_name || 'Без імені'}</div>
                <div className="admin-access-phone">{entry.phone || 'Без телефону'}</div>
              </div>
              <div className="admin-access-meta">
                {entry.tg_user_id && <span>TG {entry.tg_user_id}</span>}
                <time dateTime={entry.created_at}>{formatKyivDateTime(entry.created_at)}</time>
              </div>
              <button
                type="button"
                className="admin-access-delete"
                aria-label={`Видалити запис входу ${entry.phone || ''}`}
                title="Видалити запис"
                disabled={Boolean(deletingAccessLogIds[entry.id])}
                onClick={() => handleDeleteAccessLog(entry)}
              >
                ×
              </button>
            </article>
          ))}
          {!accessLogsLoading && !accessLogsError && accessLogs.length === 0 && (
            <div className="admin-activity-loading">Записів входу ще немає</div>
          )}
        </div>
      )}

      {activeSection === 'lovecare' && (
        <section className="lovecare-admin-section">
          <div className="lovecare-admin-head">
            <div>
              <div className="admin-create-title">Реакції LoveCare</div>
              <div className="admin-settings-subtitle">Один вхід — одна картка з усіма реакціями цього сеансу.</div>
            </div>
            <div className="lovecare-admin-count">{loveCareSessions.length}</div>
          </div>

          <div className="admin-access-search lovecare-admin-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              inputMode="search"
              value={loveCareSearch}
              placeholder="Пошук за ПІБ, товаром або номером"
              onChange={(event) => setLoveCareSearch(event.target.value)}
            />
            {loveCareSearch && (
              <button type="button" aria-label="Очистити пошук" onClick={() => setLoveCareSearch('')}>×</button>
            )}
          </div>

          <div className="lovecare-admin-list">
            {loveCareLoading && <div className="admin-activity-loading">Завантаження реакцій…</div>}
            {loveCareError && <div className="admin-activity-error">{loveCareError}</div>}
            {!loveCareLoading && !loveCareError && filteredLoveCareSessions.map((session) => {
              const opened = session.opened || {};
              const likedProducts = session.reactions.filter((entry) => entry.reaction === 'like');
              const dislikedProducts = session.reactions.filter((entry) => entry.reaction !== 'like');
              const isDeleting = Boolean(deletingLoveCareSessionIds[session.id]);
              const isConfirmingDelete = confirmingLoveCareSessionId === session.id;

              return (
                <article key={session.id} className="lovecare-admin-session">
                  <header className="lovecare-admin-session-head">
                    <div className="lovecare-admin-session-icon" aria-hidden="true">♥</div>
                    <div className="lovecare-admin-main">
                      <div className="lovecare-admin-user">{cleanActivityText(opened.last_name, 'Без імені')}</div>
                      <div className="lovecare-admin-phone">{cleanActivityText(opened.phone, 'Без телефону')}</div>
                    </div>
                    <div className="lovecare-admin-meta">
                      <span className="lovecare-admin-label">Зайшов(ла)</span>
                      {opened.tg_user_id && <span>TG {opened.tg_user_id}</span>}
                      <time dateTime={opened.created_at}>{formatKyivDateTime(opened.created_at)}</time>
                      {session.closed?.created_at && <span>Вийшов(ла) {formatKyivDateTime(session.closed.created_at)}</span>}
                    </div>
                    <button
                      type="button"
                      className="lovecare-admin-delete"
                      aria-label="Видалити цей вхід LoveCare та реакції"
                      title="Видалити вхід і реакції"
                      onClick={() => setConfirmingLoveCareSessionId(session.id)}
                      disabled={isDeleting}
                    >
                      {isDeleting ? '…' : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" />
                        </svg>
                      )}
                    </button>
                  </header>

                  {isConfirmingDelete && (
                    <div className="lovecare-admin-delete-confirm" role="alert">
                      <span>Видалити цей вхід і всі реакції?</span>
                      <div>
                        <button
                          type="button"
                          className="lovecare-admin-delete-confirm-action"
                          onClick={() => handleDeleteLoveCareSession(session)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? 'Видаляємо…' : 'Так, видалити'}
                        </button>
                        <button
                          type="button"
                          className="lovecare-admin-delete-cancel"
                          onClick={() => setConfirmingLoveCareSessionId('')}
                          disabled={isDeleting}
                        >
                          Скасувати
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="lovecare-admin-reactions">
                    {session.reactions.length ? (
                      <>
                        {likedProducts.length > 0 && (
                          <div className="lovecare-admin-reaction-group lovecare-admin-reaction-group--like">
                            <div className="lovecare-admin-reaction-group-title"><span>♥</span> Подобається <b>{likedProducts.length}</b></div>
                            {likedProducts.map((entry, index) => {
                              const productName = cleanActivityText(entry.product_name, 'Товар');
                              const productCategory = cleanActivityText(entry.product_category);
                              return (
                                <div key={entry.id || `${entry.created_at}-${index}`} className="lovecare-admin-reaction">
                                  <div>
                                    <strong>{productName}</strong>
                                    {productCategory && <span>{productCategory}</span>}
                                  </div>
                                  <time dateTime={entry.created_at}>{formatKyivDateTime(entry.created_at)}</time>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {dislikedProducts.length > 0 && (
                          <div className="lovecare-admin-reaction-group lovecare-admin-reaction-group--dislike">
                            <div className="lovecare-admin-reaction-group-title"><span>×</span> Не подобається <b>{dislikedProducts.length}</b></div>
                            {dislikedProducts.map((entry, index) => {
                              const productName = cleanActivityText(entry.product_name, 'Товар');
                              const productCategory = cleanActivityText(entry.product_category);
                              return (
                                <div key={entry.id || `${entry.created_at}-${index}`} className="lovecare-admin-reaction">
                                  <div>
                                    <strong>{productName}</strong>
                                    {productCategory && <span>{productCategory}</span>}
                                  </div>
                                  <time dateTime={entry.created_at}>{formatKyivDateTime(entry.created_at)}</time>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="lovecare-admin-empty-session">Реакцій у цьому вході ще немає</div>
                    )}
                  </div>
                </article>
              );
            })}
            {!loveCareLoading && !loveCareError && filteredLoveCareSessions.length === 0 && (
              <div className="admin-activity-loading">
                {loveCareActivity.length ? 'За цим пошуком входів немає' : 'LoveCare ще ніхто не відкривав'}
              </div>
            )}
          </div>
        </section>
      )}

      {activeSection === 'orders' && (
        <div className="admin-receipt-list">
          {ordersLoading && <div className="admin-activity-loading">Завантаження…</div>}
          {ordersError && <div className="admin-activity-error">{ordersError}</div>}
          {!ordersLoading && !ordersError && orders.map((order) => {
            const items = normalizeOrderItems(order.items);

            return (
              <article key={order.id} className="admin-receipt">
                <div className="admin-receipt-head">
                  <div>
                    <div className="admin-receipt-title">Чек #{order.id}</div>
                    <div className="admin-receipt-date">{formatKyivDateTime(order.created_at)}</div>
                  </div>
                  {order.status && <span className="admin-receipt-status">{order.status}</span>}
                </div>

                <div className="admin-receipt-customer">
                  {order.last_name && <div>{order.last_name}</div>}
                  {order.phone && <div>{order.phone}</div>}
                  {order.tg_username && <div>@{order.tg_username}</div>}
                </div>

                {items.length > 0 && (
                  <div className="admin-receipt-lines">
                    {items.map((item, index) => {
                      const qty = Number(item.qty || 0);
                      const price = Number(item.price || 0);
                      const lineTotal = qty * price;

                      return (
                        <div key={`${item.id || item.sku || index}-${index}`} className="admin-receipt-line">
                          <div className="admin-receipt-line-main">
                            <span className="admin-receipt-item-name">{item.name || 'Товар'}</span>
                            {item.sku && <span className="admin-receipt-item-sku">{item.sku}</span>}
                          </div>
                          <div className="admin-receipt-line-price">
                            <span>{qty} x {formatPrice(price)} ₴</span>
                            <strong>{formatPrice(lineTotal)} ₴</strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="admin-receipt-total">
                  <span>Разом</span>
                  <strong>{formatPrice(order.total)} ₴</strong>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {isProductSection && (
      <>
      {/* Категорії */}
      <div className="categories-scroll">
        {allCategories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`category-chip ${activeCategory === cat ? 'active' : ''}`}
            onClick={() => handleCategoryClick(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Підкатегорії */}
      {subCategories.length > 1 && (
        <div className="categories-scroll" style={{ paddingTop: 4, paddingBottom: 12 }}>
          {subCategories.map((sub) => (
            <button
              key={sub}
              type="button"
              className={`category-chip ${activeSubCategory === sub ? 'active' : ''}`}
              onClick={() => setActiveSubCategory(sub)}
              style={activeSubCategory === sub ? {} : { background: 'rgba(255,255,255,0.5)', borderColor: 'rgba(14,165,233,0.1)' }}
            >
              {sub}
            </button>
          ))}
        </div>
      )}

      <div className={`admin-content ${activeSection === 'visibility' ? 'admin-content--visibility' : ''}`}>
        {loading && <div className="no-results" style={{ paddingTop: 48 }}>Завантаження…</div>}
        {error && <div className="no-results" style={{ paddingTop: 48, color: '#ef4444' }}>{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="no-results" style={{ paddingTop: 48 }}>Нічого не знайдено</div>
        )}
        {!loading && !error && filtered.map((p) => {
          const edit = getEdit(p);
          const dirty = isDirty(p);
          const isSaving = saving[p.id];
          const isSaved = saved[p.id];
          const isImageReloading = imageReloading[p.id];
          const isImageReloaded = imageReloaded[p.id];

          return (
            <div
              key={p.id}
              className={`admin-card ${activeSection === 'visibility' ? 'admin-card--visibility' : ''} ${!p.view ? 'admin-card--hidden' : ''}`}
            >
              <div className="admin-card-top">
                <SafeImage
                  className="admin-card-img"
                  placeholderClassName="admin-card-img admin-card-img--placeholder"
                  src={p.thumbnail_url}
                  alt={p.name}
                />
                <div className="admin-card-info">
                  <div className="admin-card-name">{p.name}</div>
                  {p.sku && <div className="admin-card-sku">{p.sku}</div>}
                  <div className="admin-card-cat">{p.category}</div>
                </div>
                {activeSection === 'details' ? (
                  <div className="admin-card-actions">
                    <label className={`admin-image-refresh admin-image-upload ${imageUploading[p.id] ? 'is-disabled' : ''}`}>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={imageUploading[p.id] || isImageReloading}
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          e.currentTarget.value = '';
                          handleUploadImageFile(p, file);
                        }}
                      />
                      {imageUploading[p.id] ? 'Завантаження…' : '↑ Файл'}
                    </label>
                    <button
                      type="button"
                      className="admin-image-refresh"
                      disabled={isImageReloading || imageUploading[p.id]}
                      onClick={() => handleReloadImage(p)}
                    >
                      {isImageReloading ? 'Оновлення…' : '↻ Фото'}
                    </button>
                    {isImageReloaded && <span className="admin-image-refreshed">✓ Фото</span>}
                  </div>
                ) : (
                  <div className="admin-card-actions">
                    <button
                      type="button"
                      className={`admin-toggle ${p.view ? 'admin-toggle--on' : 'admin-toggle--off'}`}
                      disabled={isSaving}
                      onClick={() => handleToggleView(p)}
                    >
                      {p.view ? 'Видимий' : 'Прихований'}
                    </button>
                  </div>
                )}
              </div>

              {activeSection === 'details' && (
                <div className="admin-card-fields">
                  <label className="admin-label">
                    <span>category</span>
                    <input className="admin-input" type="text" value={edit.category} placeholder="категорія"
                      onChange={(e) => handleField(p.id, 'category', e.target.value)} />
                  </label>
                  <label className="admin-label">
                    <span>p_category</span>
                    <input className="admin-input" type="text" value={edit.p_category} placeholder="підкатегорія"
                      onChange={(e) => handleField(p.id, 'p_category', e.target.value)} />
                  </label>
                  <label className="admin-label">
                    <span>badge</span>
                    <input className="admin-input" type="text" value={edit.badge} placeholder="хіт / new / акція"
                      onChange={(e) => handleField(p.id, 'badge', e.target.value)} />
                  </label>
                  <label className="admin-label">
                    <span>price</span>
                    <input className="admin-input" type="number" inputMode="decimal" value={edit.price} placeholder="ціна"
                      onChange={(e) => handleField(p.id, 'price', e.target.value)} />
                  </label>
                  <label className="admin-label">
                    <span>number_sites</span>
                    <input className="admin-input" type="number" inputMode="numeric" value={edit.number_sites} placeholder="порядок"
                      onChange={(e) => handleField(p.id, 'number_sites', e.target.value)} />
                  </label>
                  {dirty && (
                    <button type="button" className="admin-save-btn" disabled={isSaving} onClick={() => handleSave(p)}>
                      {isSaving ? 'Збереження…' : 'Зберегти'}
                    </button>
                  )}
                  {isSaved && <span className="admin-saved-badge">✓ Збережено</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
