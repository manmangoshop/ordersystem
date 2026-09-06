export function productDisplayName(brand: string | null | undefined, name: string) {
  const cleanBrand = brand?.trim() ?? "";
  const cleanName = name.trim();
  if (!cleanBrand || cleanName.toLocaleLowerCase().includes(cleanBrand.toLocaleLowerCase())) return cleanName;
  return `${cleanBrand} ${cleanName}`;
}
