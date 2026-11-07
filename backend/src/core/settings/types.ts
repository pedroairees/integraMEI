export const timeZones = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Rio_Branco",
] as const;
export interface SettingsInput {
  fullName: string;
  phone: string;
  emailAlerts: boolean;
  invoiceReminders: boolean;
  lowStockAlerts: boolean;
  timeZone: (typeof timeZones)[number];
}
export interface Settings extends SettingsInput {
  email: string;
  pendingEmail: string | null;
  cnpj: string;
}
export interface SettingsRepository {
  get(): Promise<Settings>;
  save(input: SettingsInput): Promise<Settings>;
  changeEmail(email: string): Promise<void>;
  requestPasswordReset(password: string): Promise<void>;
}
