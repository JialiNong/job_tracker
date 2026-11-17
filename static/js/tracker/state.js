/* Tracker page state shared by the tracker/*.js modules.

   Constants and the shared Sets / maps are exported directly. Scalars that
   more than one module reassigns live on `state`, because an ES module
   cannot assign to a binding it imported. */

export const jobHighlights = {}; // job_id -> string[]
export const HIGHLIGHT_PRESETS = ['Leipzig', 'Chinese+'];
export const STATUS_LABEL = {
  pending:    'Not applied',
  applied:    'Applied',
  screening:  'Screening',
  rejected:   'Rejected',
  interview:  'Interview',
  interview_cancelled: 'Cancelled',
  offer:      'Offer',
  unsuitable: 'Unsuitable',
  closed:     'Closed',
  closed_no_reply: 'Closed, no reply',
  prev_rejected: 'Rejected before',
  too_many_questions: 'Skipped, long form',
  repost:     'Repost',
  duplicate:  'Duplicate',
};
export const SIDE_STATUSES = ['unsuitable', 'closed', 'closed_no_reply', 'prev_rejected', 'too_many_questions', 'repost', 'duplicate'];
export const PROGRESS_STAGES = ['applied', 'screening', 'rejected', 'interview', 'interview_cancelled', 'offer'];
export const selectedFetchIds = new Set();
// Selected cards that are not eligible for batch Fetch / Run AI (already
// scored) — only Delete selected acts on them.
export const selectedDeleteOnlyIds = new Set();
export const TIMELINE_LABEL = {
  applied:          'Applied',
  reapplied:        'Reapplied',
  screening:        'Screening',
  screening_done:   'Submitted',
  interview_invite: 'Invite',
  interview_1:      'Round 1',
  interview_2:      'Round 2',
  interview_3:      'Round 3',
  interview_final:  'Final',
  interview_cancelled: 'Cancelled',
  rejected:         'Rejected',
  offer:            'Offer',
};
export const INTERVIEW_STEPS = ['interview_1', 'interview_2', 'interview_3', 'interview_final'];
export const GOT_INTERVIEW_FILTER = 'got_interview';
export const GOT_INTERVIEW_STEPS = new Set(['interview_invite', ...INTERVIEW_STEPS, 'offer']);
export const TERMINAL_STEPS = new Set(['rejected', 'offer']);
/** In-memory timeline cache keyed by job id */
export const jobTimelines = {};

export const state = {
  currentStatusFilter: 'active',
  // Pagination (the job list)
  currentPage: 1,
  totalPages: 1,
  totalJobs: 0,
  // "Select jobs" mode: card checkboxes are hidden until it is turned on.
  selectMode: false,
  // Batch Fetch details / Run AI
  fetchBatchPollTimer: null,
  fetchBatchRunning: false,
  fetchBatchMode: 'fetch',
};
