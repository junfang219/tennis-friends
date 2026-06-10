"use client";

import { useState } from "react";
import { PAYMENT_LABELS, type PaymentMethod } from "@/lib/payment";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { updateMyProfile } from "@/lib/supabase/queries";
import { errorMessage } from "@/lib/errorMessage";

type Handles = {
  venmoHandle: string | null;
  paypalHandle: string | null;
  cashappHandle: string | null;
  zelleHandle: string | null;
};

const METHOD_PLACEHOLDERS: Record<PaymentMethod, string> = {
  venmo: "username (no @)",
  paypal: "PayPal.me username",
  cashapp: "$cashtag (no $)",
  zelle: "phone or email",
};

const METHOD_FIELDS: Record<PaymentMethod, keyof Handles> = {
  venmo: "venmoHandle",
  paypal: "paypalHandle",
  cashapp: "cashappHandle",
  zelle: "zelleHandle",
};

/**
 * Editable card for the signed-in user's payment handles (Venmo / PayPal /
 * Cash App / Zelle). Shown to a creditor so debtors have something to pay to.
 * Shared by the in-chat Split-a-cost sheet and the team Expenses tab.
 */
export default function PaymentSetupCard({
  handles,
  onSaved,
}: {
  handles: Handles;
  onSaved: () => void;
}) {
  const setMethods = (Object.keys(METHOD_FIELDS) as PaymentMethod[]).filter(
    (m) => (handles[METHOD_FIELDS[m]] || "").trim().length > 0
  );
  const hasAny = setMethods.length > 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    venmoHandle: "",
    paypalHandle: "",
    cashappHandle: "",
    zelleHandle: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const openEditor = () => {
    setDraft({
      venmoHandle: handles.venmoHandle || "",
      paypalHandle: handles.paypalHandle || "",
      cashappHandle: handles.cashappHandle || "",
      zelleHandle: handles.zelleHandle || "",
    });
    setError("");
    setEditing(true);
  };

  const onSave = async () => {
    setSaving(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      await updateMyProfile(supabase, {
        venmo_handle: draft.venmoHandle.trim() || null,
        paypal_handle: draft.paypalHandle.trim() || null,
        cashapp_handle: draft.cashappHandle.trim() || null,
        zelle_handle: draft.zelleHandle.trim() || null,
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "Network error."));
    }
    setSaving(false);
  };

  if (!editing) {
    return (
      <div className="rounded-xl border border-court-green-pale/40 bg-court-green-pale/10 p-3">
        {hasAny ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-court-green">
                Your payment handles
              </p>
              <p className="text-[11px] text-gray-600 truncate">
                {setMethods.map((m) => PAYMENT_LABELS[m]).join(", ")}
              </p>
            </div>
            <button
              onClick={openEditor}
              className="text-[11px] font-semibold text-court-green hover:text-court-green-light px-2 py-1 rounded-md hover:bg-white/60 shrink-0"
            >
              Edit
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-court-green">
                Set up payment handles
              </p>
              <p className="text-[11px] text-gray-600">
                So players can pay you back via Venmo, PayPal, Cash App, or Zelle.
              </p>
            </div>
            <button
              onClick={openEditor}
              className="bg-court-green text-white text-[11px] font-bold px-3 py-1.5 rounded-lg hover:bg-court-green-light shrink-0"
            >
              Set up
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-court-green-pale/40 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700">Payment handles</p>
        <button
          onClick={() => setEditing(false)}
          className="text-[11px] text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-gray-500">
        Fill in any you have. Empty fields are removed. Debtors will see a button per filled method.
      </p>
      {(Object.keys(METHOD_FIELDS) as PaymentMethod[]).map((m) => {
        const field = METHOD_FIELDS[m];
        return (
          <div key={m}>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              {PAYMENT_LABELS[m]}
            </label>
            <input
              type="text"
              value={draft[field] ?? ""}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              placeholder={METHOD_PLACEHOLDERS[m]}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        );
      })}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={onSave}
        disabled={saving}
        className="bg-court-green text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-court-green-light disabled:opacity-50 w-full"
      >
        {saving ? "Saving..." : "Save all"}
      </button>
    </div>
  );
}
