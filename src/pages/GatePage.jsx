import React, { useState } from 'react';
import { logAccess } from '../lib/supabase';

export function GatePage({ onAuthorized, tgUserId }) {
  const [phone, setPhone] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = phone.trim().length >= 6 && lastName.trim().length >= 1;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setError('');

    try {
      // Записати вхід в Supabase access_log
      await logAccess({
        phone: phone.trim(),
        lastName: lastName.trim(),
        tgUserId,
      });

      // Передати дані батьківському компоненту
      onAuthorized({
        phone: phone.trim(),
        lastName: lastName.trim(),
      });
    } catch (err) {
      console.error('Gate error:', err);
      setError('Помилка з\'єднання. Спробуйте ще раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="gate-page">
      <div className="gate-logo">🛍</div>
      <h1 className="gate-title">Вітаємо!</h1>
      <p className="gate-subtitle">
        Для перегляду каталогу введіть номер телефону та прізвище
      </p>

      <form className="gate-form" onSubmit={handleSubmit}>
        <input
          className="gate-input"
          type="tel"
          inputMode="tel"
          placeholder="+380 XX XXX XX XX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
        <input
          className="gate-input"
          type="text"
          placeholder="Прізвище"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          autoComplete="family-name"
        />

        {error && <div className="gate-error">{error}</div>}

        <button
          className="gate-btn"
          type="submit"
          disabled={!canSubmit || loading}
        >
          {loading ? 'Зачекайте…' : 'Увійти'}
        </button>
      </form>

      <p className="gate-note">
        З вами зв'яжеться менеджер для уточнення деталей та оплати.
      </p>
    </div>
  );
}
