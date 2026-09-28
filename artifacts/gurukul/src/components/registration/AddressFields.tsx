export type AddressParts = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export type AddressErrors = Partial<Record<keyof AddressParts, string>>;

export const EMPTY_ADDRESS: AddressParts = { street: "", city: "", state: "", zip: "" };

const USPS_STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC AS GU MP PR VI UM".split(" "),
);

export function parseAddress(value: string | null | undefined): AddressParts {
  const match = value?.trim().match(/^(.+),\s*(.+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  return match
    ? { street: match[1], city: match[2], state: match[3], zip: match[4] }
    : { ...EMPTY_ADDRESS };
}

export function validateAddressParts(parts: AddressParts): AddressErrors {
  const errors: AddressErrors = {};
  if (!parts.street.trim()) errors.street = "Street address is required.";
  else if (parts.street.trim().length < 5 || !/\d/.test(parts.street))
    errors.street = "Enter a full street address with a number.";
  if (!parts.city.trim()) errors.city = "City is required.";
  else if (parts.city.trim().length < 2) errors.city = "Enter a valid city.";
  if (!USPS_STATE_CODES.has(parts.state.trim().toUpperCase()))
    errors.state = "Enter a valid U.S. state, DC, or territory abbreviation.";
  if (!/^\d{5}(?:-\d{4})?$/.test(parts.zip.trim())) errors.zip = "Enter a 5-digit ZIP code.";
  return errors;
}

/** Existing addresses must meet the same requirements as newly entered ones. */
export function isCompleteAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  const parts = parseAddress(value);
  return Object.keys(validateAddressParts(parts)).length === 0;
}

export function formatAddressParts(parts: AddressParts): string {
  return `${parts.street.trim()}, ${parts.city.trim()}, ${parts.state.trim().toUpperCase()} ${parts.zip.trim()}`;
}

export function AddressFields({
  value, onChange, errors = {},
}: {
  value: AddressParts;
  onChange: (next: AddressParts) => void;
  errors?: AddressErrors;
}) {
  const fields: { key: keyof AddressParts; label: string; placeholder: string; autoComplete: string }[] = [
    { key: "street", label: "Street address", placeholder: "123 Maple Dr", autoComplete: "street-address" },
    { key: "city", label: "City", placeholder: "Powell", autoComplete: "address-level2" },
    { key: "state", label: "State", placeholder: "OH", autoComplete: "address-level1" },
    { key: "zip", label: "ZIP code", placeholder: "43065", autoComplete: "postal-code" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {fields.map(({ key, label, placeholder, autoComplete }) => (
        <label key={key} className={key === "street" ? "sm:col-span-2" : ""}>
          <span className="block text-xs font-semibold text-secondary mb-1">
            {label} <span className="text-red-500">*</span>
          </span>
          <input
            value={value[key]}
            onChange={e => onChange({ ...value, [key]: e.target.value })}
            placeholder={placeholder}
            autoComplete={autoComplete}
            maxLength={key === "state" ? 2 : key === "zip" ? 10 : undefined}
            aria-invalid={!!errors[key]}
            data-field-error={errors[key] ? "true" : undefined}
            className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white ${errors[key] ? "border-red-400" : "border-border"}`}
          />
          {errors[key] && <p className="mt-1 text-xs text-red-600" role="alert">{errors[key]}</p>}
        </label>
      ))}
    </div>
  );
}