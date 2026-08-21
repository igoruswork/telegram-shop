import React, { useEffect, useState } from 'react';
import { fetchCatalogUserAccess, logAccess, requestCatalogAccess } from '../lib/supabase';
import { PHONE_PREFIX, isPhoneComplete, normalizePhoneInput } from '../lib/phone';

export function GatePage({ onAuthorized, tgUserId }) {
  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [phoneChecking, setPhoneChecking] = useState(false);
  const [error, setError] = useState('');

  const phoneComplete = isPhoneComplete(phone);
  const canSubmit = phoneComplete && !phoneChecking && lastName.trim().length >= 1;

  useEffect(() => {
    const normalizedPhone = normalizePhoneInput(phone);
    if (!isPhoneComplete(normalizedPhone)) {
      setPhoneChecking(false);
      return undefined;
    }

    let cancelled = false;
    setPhoneChecking(true);

    fetchCatalogUserAccess(normalizedPhone)
      .then(async (catalogUser) => {
        if (cancelled || !catalogUser?.is_approved || catalogUser.is_blocked) return;

        try {
          await logAccess({
            phone: catalogUser.phone,
            lastName: catalogUser.last_name,
            tgUserId,
          });
        } catch (logError) {
          // The access check has already succeeded, so do not lock a user out
          // only because the non-critical audit write is temporarily unavailable.
          console.warn('approved phone access log error:', logError);
        }

        if (cancelled) return;
        onAuthorized({
          phone: catalogUser.phone,
          lastName: catalogUser.last_name,
        });
      })
      .catch((checkError) => {
        // The user can still proceed through the regular form if this quick
        // lookup is temporarily unavailable.
        console.warn('approved phone check error:', checkError);
      })
      .finally(() => {
        if (!cancelled) setPhoneChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onAuthorized, phone, tgUserId]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setError('');

    try {
      const catalogUser = await requestCatalogAccess({
        phone: normalizePhoneInput(phone),
        lastName: lastName.trim(),
        tgUserId,
      });

      if (catalogUser?.is_blocked) {
        return;
      }

      onAuthorized({
        phone: catalogUser?.phone || normalizePhoneInput(phone),
        lastName: catalogUser?.last_name || lastName.trim(),
      });
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
            const nextPhone = normalizePhoneInput(event.target.value);
            setPhone(nextPhone);
            setPhoneChecking(isPhoneComplete(nextPhone));
            setLastName('');
            setError('');
          }}
          autoComplete="tel"
          maxLength={13}
          aria-invalid={!phoneComplete && phone !== PHONE_PREFIX}
          onFocus={(event) => event.currentTarget.select()}
        />
        {phoneComplete && !phoneChecking && (
          <input
            className="gate-input"
            type="text"
            placeholder="Ім'я та Прізвище"
            value={lastName}
            onChange={(event) => {
              setLastName(event.target.value);
              setError('');
            }}
            autoComplete="name"
          />
        )}

        {error && <div className="gate-error">{error}</div>}
        <button className="gate-btn" type="submit" disabled={!canSubmit || loading}>
          {loading ? 'Зачекайте…' : 'Увійти до каталогу'}
        </button>
      </form>
    </div>
  );
}
