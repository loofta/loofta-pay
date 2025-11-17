// Main routes
export const HOME_ROUTE = '/';
export const CREATORS_ROUTE = '/creators';
export const DEALS_ROUTE = '/deals';
export const PROFILE_ROUTE = '/settings/profile';
export const SETTINGS_ROUTE = '/settings';
export const BRIDGE_ROUTE = '/bridge';

// Freelancer routes
export const FREELANCER_DETAILS_ROUTE = (id: string) => `/creators/${id}`;
export const CREATE_FREELANCER_ROUTE = '/creators/create';
export const EDIT_FREELANCER_ROUTE = (id: string) => `/creators/${id}/edit`;
export const JOIN_ROUTE = '/settings/join';
// Deal routes
export const CREATE_DEAL_ROUTE = '/create';
export const CREATE_DEAL_NEW_ROUTE = '/create/newDeal';
export const DEAL_SUMMARY_ROUTE = '/create/summary';
export const DEAL_DETAILS_ROUTE = (id: string) => `/deal/${id}`;
export const CONGRATS_ROUTE = '/create/congrats';
// Authentication routes
export const LOGIN_ROUTE = '/login';
export const REGISTER_ROUTE = '/register';

// Other routes
export const SEARCH_ROUTE = '/search';
export const NOTIFICATIONS_ROUTE = '/notifications';
export const MESSAGES_ROUTE = '/messages';



// Campaign routes
export const CAMPAIGNS_ROUTE = '/campaigns';
export const CREATE_CAMPAIGN_ROUTE = '/campaigns/new';
export const CAMPAIGN_DETAILS_ROUTE = (id: string) => `/campaigns/${id}`;
export const CREATE_CAMPAIGN_FORM_ROUTE = '/campaigns/create';

export const DEALS_REFERRAL_ROUTE = '/deals/referral';

// Settings routes
export const TROUBLESHOOT_ROUTE = '/settings/troubleshoot';

// Add this with the other routes
export const RANK_ROUTE = '/rank';

export const STORE_ROUTE = '/store';