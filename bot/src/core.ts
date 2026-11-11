/**
 * The ONE door between the bot and the shared marketplace domain.
 *
 * The domain (Mongo models, escrow/payment/payout services, config) lives in ../backend and is
 * owned there. The bot never reaches into that tree anywhere else: every handler imports from
 * this file, so the coupling is visible and greppable in a single place, and a future move to
 * a pure HTTP client only has to replace this module.
 *
 * Only what the Telegram interface needs is re-exported — the website routes, the HTTP
 * server, the webhooks and the scheduler stay exclusive to the API service.
 */
export { config, CATEGORIES, isAdminTelegramId, safeEquals } from '../../backend/src/config';
export type { RefundTier, PaymentCard } from '../../backend/src/config';
export { connectDatabase } from '../../backend/src/db/mongoose';

export { User } from '../../backend/src/models/User';
export type { IUser } from '../../backend/src/models/User';
export { Product } from '../../backend/src/models/Product';
export { Transaction } from '../../backend/src/models/Transaction';
export { EscrowHold } from '../../backend/src/models/EscrowHold';
export { PaymentInbox } from '../../backend/src/models/PaymentInbox';
export { Payout } from '../../backend/src/models/Payout';
export { Dispute } from '../../backend/src/models/Dispute';
export { LoginRequest } from '../../backend/src/models/LoginRequest';
export { audit } from '../../backend/src/models/AuditLog';
export { mongoSessionStore } from '../../backend/src/models/BotSession';

export { marketplace, BlockedUserError } from '../../backend/src/services/marketplaceService';
export {
  paymentService,
  AlreadyProcessedError,
  ForbiddenError,
  PaymentAllocationError,
  ProductUnavailableError,
} from '../../backend/src/services/paymentService';
export { payoutService, InsufficientBalanceError } from '../../backend/src/services/payoutService';
export { ledgerService, accounts } from '../../backend/src/services/ledgerService';
export { describeRefundPolicy } from '../../backend/src/services/refundEngine';
export { notificationService } from '../../backend/src/services/notificationService';
export { uploadTelegramPhoto, ImageUploadError } from '../../backend/src/services/cloudinaryService';
export { parseListingCode } from '../../backend/src/utils/listingCode';
export { sha256, encryptSecret, decryptSecret } from '../../backend/src/utils/crypto';
export {
  escapeHtml,
  formatUzs,
  formatDeadline,
  formatDateTime,
  formatCardNumber,
  formatDealCode,
  isValidUzCard,
  maskCard,
  generateDealCode,
  normalizeDealCode,
} from '../../backend/src/utils/helpers';
