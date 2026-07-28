import React, { useState } from 'react';
import { requestCatalogAccess } from '../lib/supabase';
import { PHONE_PREFIX, isPhoneComplete, normalizePhoneInput } from '../lib/phone';

export function GatePage({ onAuthorized, tgUserId }) {
  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const phoneComplete = isPhoneComplete(phone);
  const canSubmit = phoneComplete && lastName.trim().length >= 1;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setError('');
    setPending(false);

    try {
      const catalogUser = await requestCatalogAccess({
        phone: normalizePhoneInput(phone),
        lastName: lastName.trim(),
        tgUserId,
      });

      if (catalogUser?.is_approved) {
        onAuthorized({
          phone: catalogUser.phone,
          lastName: catalogUser.last_name || lastName.trim(),
        });
        return;
      }

      setPending(true);
    } catch (err) {
      console.error('Gate error:', err);
      setError(err.message || 'Помилка з\'єднання. Спробуйте ще раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="gate-page">
      <div className="gate-logo">🛍</div>
      <h1 className="gate-title">Вітаємо!</h1>
      <p className="gate-subtitle">
        Для перегляду введіть номер телефону, ім'я та прізвище
      </p>

      <form className="gate-form" onSubmit={handleSubmit}>
        <input
          className="gate-input"
          type="tel"
          inputMode="numeric"
          placeholder="+380502847652"
          value={phone}
          onChange={(event) => {
            setPhone(normalizePhoneInput(event.target.value));
            setError('');
            setPending(false);
          }}
          autoComplete="tel"
          maxLength={13}
          aria-invalid={!phoneComplete && phone !== PHONE_PREFIX}
          onFocus={(event) => event.currentTarget.select()}
        />
        {phoneComplete && (
          <input
            className="gate-input"
            type="text"
            placeholder="Ім'я та Прізвище"
            value={lastName}
            onChange={(event) => {
              setLastName(event.target.value);
              setError('');
              setPending(false);
            }}
            autoComplete="name"
          />
        )}

        {error && <div className="gate-error">{error}</div>}
        {pending && (
          <div className="gate-note gate-pending-note">
            Заявку на доступ збережено. Після схвалення адміністратором увійдіть ще раз.
          </div>
        )}

        <button className="gate-btn" type="submit" disabled={!canSubmit || loading}>
          {loading ? 'Зачекайте…' : 'Надіслати запит'}
        </button>
      </form>

      <p className="gate-note">
        Адміністратор підтверджує доступ перед переглядом каталогу.
      </p>
    </div>
  );
}
