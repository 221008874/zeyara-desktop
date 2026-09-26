export interface Patient {
  id?: number;
  name: string;
  phone: string;
  age?: number;
  gender?: string;
  diagnosis?: string;
  heightCm?: number;
  weightKg?: number;
  bodyTemperature?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  bmi?: number;
  bmiCategory?: string;
  isPregnant?: boolean;
  pregnancyWeeks?: number;
  allergies?: string;
  chronicConditions?: string;
  notes?: string;
  followUpDate?: string;
  createdBy?: string;
  tenantId?: string;
  synced?: boolean;
  createdAt?: string;
  lastUpdated?: string;
  version?: number;
}

export interface Appointment {
  id?: number;
  patientId?: number;
  patientName?: string;
  date?: string;
  time?: string;
  timeZone?: 'MORNING' | 'AFTERNOON' | 'NIGHT';
  status?: 'SCHEDULED' | 'MOVED' | 'DONE' | 'CANCELLED';
  category?: 'EXAMINATION' | 'FOLLOW_UP';
  requiredAmount?: number;
  notes?: string;
  doctorId?: number;
  doctorName?: string;
  createdBy?: string;
  synced?: boolean;
  createdAt?: string;
  lastUpdated?: string;
  version?: number;
}

export interface Expense {
  id?: number;
  title: string;
  amount: number;
  category: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  notes?: string;
  expenseDate?: string;
  createdBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  synced?: boolean;
  createdAt?: string;
  lastUpdated?: string;
  version?: number;
}

export interface Payment {
  id?: number;
  patientId?: number;
  appointmentId?: number;
  totalAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  paymentMethod?: string;
  notes?: string;
  paymentDate?: string;
  createdBy?: string;
  synced?: boolean;
  lastUpdated?: string;
  version?: number;
}

export interface Notification {
  id?: number;
  title?: string;
  body?: string;
  seen?: boolean;
  type?: string;
  createdAt?: string;
  lastUpdated?: string;
  version?: number;
}

export interface Doctor {
  id?: number;
  name: string;
  phone?: string;
  username: string;
  password?: string;
  synced?: boolean;
  forcePasswordChange?: boolean;
  version?: number;
}

export interface Secretary {
  id?: number;
  name: string;
  phone?: string;
  username: string;
  password?: string;
  synced?: boolean;
  forcePasswordChange?: boolean;
  version?: number;
}

export interface Medication {
  id?: number;
  patientId?: number;
  drugName: string;
  dosage: string;
  frequency: string;
  duration?: number;
  instructions?: string;
  startDate?: string;
  endDate?: string;
  status?: 'Active' | 'Stopped';
  synced?: boolean;
  createdAt?: string;
  lastUpdated?: string;
  version?: number;
}

export interface PatientHistory {
  id?: number;
  patientId?: number;
  appointmentId?: number;
  category?: string;
  diagnosis?: string;
  notes?: string;
  createdBy?: string;
  doctorId?: number;
  synced?: boolean;
  createdAt?: string;
  lastUpdated?: string;
  version?: number;
}

export interface ScheduleEntry {
  id?: number;
  date?: string;
  timeZone?: string;
  startTime?: string;
  endTime?: string;
  cancelled?: boolean;
  doctorId?: number;
  synced?: boolean;
  createdAt?: string;
  lastUpdated?: string;
  version?: number;
}

export interface MoneySafeTransaction {
  id?: number;
  type?: 'CREDIT' | 'DEBIT';
  amount?: number;
  description?: string;
  sourceType?: string;
  sourceId?: number;
  createdAt?: string;
  notes?: string;
}

export interface FinancialReport {
  period?: string;
  startDate?: string;
  endDate?: string;
  totalIncome?: number;
  totalExpenses?: number;
  netBalance?: number;
  transactionCount?: number;
}

export interface DashboardSummary {
  kpis?: {
    patientsToday?: number;
    appointmentsToday?: number;
    revenueToday?: number;
    activeAlerts?: number;
  };
  todayAppointments?: Appointment[];
  recentPatients?: Patient[];
  recentNotifications?: Notification[];
  backupStatus?: any;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  username: string;
  role: 'ADMIN' | 'DOCTOR' | 'SECRETARY';
  mustChangePassword?: boolean;
}

export interface LicenseValidateResponse {
  status: string;
  message?: string;
  expiryDate?: string;
  daysUntilExpiry?: number;
  unlocked?: boolean;
}

export interface LicenseStatusResponse {
  locked: boolean;
  reason?: string;
  timestamp?: string;
}

export interface ServerHealth {
  status: string;
  patientsToday?: number;
  appointmentsToday?: number;
  revenueToday?: number;
  activeAlerts?: number;
  uptime?: number;
}

export interface UpdateCheckResponse {
  updateAvailable: boolean;
  forceUpdate: boolean;
  latestVersion: string;
  buildNumber: string;
  downloadUrl?: string;
  msiUrl?: string;
  releaseNotes?: string;
  releaseDate?: string;
  minVersion?: string;
  fileSize?: number;
  checksum?: string;
  releaseHighlights?: string[];
  currentVersion: string;
}
