import React, { useEffect, useRef, useState } from 'react';
import { fetchLatestAccessByPhone, fetchLatestAccessByPhonePrefix, logAccess } from '../lib/supabase';
import {
  EARLY_LOOKUP_NATIONAL_DIGITS,
  PHONE_PREFIX,
  getEarlyPhoneLookupPrefix,
  getNationalDigits,
  isPhoneComplete,
  normalizePhoneInput,
} from '../lib/phone';

export function GatePage({ onAuthorized, tgUserId, autoAuthorizeKnownUser = true }) {
  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const autoFilledNameRef = useRef('');
  const autoFilledPhoneRef = useRef('');
  const lastNameRef = useRef('');
  const nameEditedRef = useRef(false);
  const autoAuthorizeRef = useRef(false);

  const phoneComplete = isPhoneComplete(phone);
  const earlyPhoneLookupPrefix = getEarlyPhoneLookupPrefix(phone);
  const canSubmit = phoneComplete && lastName.trim().length >= 1;

  const authorize = async ({ phone: phoneValue, lastName: lastNameValue }) => {
    if (loading || autoAuthorizeRef.current) return;

    const normalizedPhone = normalizePhoneInput(phoneValue);
    const normalizedName = String(lastNameValue || '').trim();

    if (!isPhoneComplete(normalizedPhone) || !normalizedName) return;

    autoAuthorizeRef.current = true;
    setLoading(true);
    setError('');

    try {
      await logAccess({
        phone: normalizedPhone,
        lastName: normalizedName,
        tgUserId,
      });

      onAuthorized({
        phone: normalizedPhone,
        lastName: normalizedName,
      });
    } catch (err) {
      console.error('Gate error:', err);
      setError('Помилка з\'єднання. Спробуйте ще раз.');
      autoAuthorizeRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  const applyLatestAccess = (latestAccess, fallbackPhone) => {
    const suggestedName = latestAccess?.last_name?.trim() || '';
    const suggestedPhone = latestAccess?.phone?.trim()
      ? normalizePhoneInput(latestAccess.phone)
      : fallbackPhone;
    const canAutoFill =
      suggestedName &&
      (!nameEditedRef.current || !lastNameRef.current.trim() || lastNameRef.current.trim() === autoFilledNameRef.current);

    if (canAutoFill) {
      autoFilledNameRef.current = suggestedName;
      autoFilledPhoneRef.current = suggestedPhone;
      lastNameRef.current = suggestedName;
      nameEditedRef.current = false;
      setLastName(suggestedName);
    }
  };

  useEffect(() => {
    if (!earlyPhoneLookupPrefix) {
      return undefined;
    }

    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        const latestAccess = await fetchLatestAccessByPhonePrefix(earlyPhoneLookupPrefix);
        if (cancelled) return;
        applyLatestAccess(latestAccess, earlyPhoneLookupPrefix);
      } catch (err) {
        if (cancelled) return;
        console.warn('Name lookup error:', err);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [earlyPhoneLookupPrefix]);

  useEffect(() => {
    if (!phoneComplete) {
      return undefined;
    }

    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        const latestAccess = await fetchLatestAccessByPhone(phone);
        if (cancelled) return;
        applyLatestAccess(latestAccess, phone);

        const suggestedName = latestAccess?.last_name?.trim() || '';
        const suggestedPhone = latestAccess?.phone ? normalizePhoneInput(latestAccess.phone) : '';

        if (
          autoAuthorizeKnownUser &&
          suggestedName &&
          suggestedPhone === phone &&
          !nameEditedRef.current
        ) {
          await authorize({
            phone,
            lastName: suggestedName,
          });
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('Name lookup error:', err);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phone, phoneComplete]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    if (!phoneComplete) {
      setError('Введіть повний номер у форматі +380XXXXXXXXX.');
      return;
    }

    if (!lastName.trim()) {
      setError('Введіть ім\'я та прізвище.');
      return;
    }

    await authorize({
      phone,
      lastName,
    });
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
          onChange={(e) => {
            const nextPhone = normalizePhoneInput(e.target.value);
            const nextNationalDigits = getNationalDigits(nextPhone);
            const shouldClearAutoFilledName =
              lastNameRef.current.trim() &&
              lastNameRef.current.trim() === autoFilledNameRef.current &&
              (
                nextNationalDigits.length < EARLY_LOOKUP_NATIONAL_DIGITS ||
                (autoFilledPhoneRef.current && !autoFilledPhoneRef.current.startsWith(nextPhone))
              );

            if (shouldClearAutoFilledName) {
              lastNameRef.current = '';
              autoFilledNameRef.current = '';
              autoFilledPhoneRef.current = '';
              nameEditedRef.current = false;
              setLastName('');
            }
            setPhone(nextPhone);
            setError('');
          }}
          autoComplete="tel"
          maxLength={13}
          aria-invalid={!phoneComplete && phone !== PHONE_PREFIX}
          onFocus={(e) => e.currentTarget.select()}
        />
        {phoneComplete && (
          <input
            className="gate-input"
            type="text"
            placeholder="Ім'я та Прізвище"
            value={lastName}
            onChange={(e) => {
              lastNameRef.current = e.target.value;
              nameEditedRef.current = true;
              setLastName(e.target.value);
              setError('');
            }}
            autoComplete="name"
          />
        )}

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
