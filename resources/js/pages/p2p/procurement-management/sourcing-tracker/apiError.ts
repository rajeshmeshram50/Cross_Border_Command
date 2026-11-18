/** The message of a failed API call: Laravel's `message`, else the first field error, else `fallback`. */
export const apiErrorMessage = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } })?.response?.data;
  return d?.message || (d?.errors && Object.values(d.errors)[0]?.[0]) || fallback;
};

/** Field errors of a 422 response ({ "new_supplier.email": ["…"] }), or {}. */
export const apiFieldErrors = (e: unknown): Record<string, string> => {
  const errs = (e as { response?: { data?: { errors?: Record<string, string[]> } } })?.response?.data?.errors ?? {};
  return Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v?.[0] ?? '']));
};
