/* Tracker page entry (templates/index.html).

   The page and the card HTML still use inline onclick="..." handlers, which
   look names up on window. Only the functions listed here are exposed; every
   other module function stays private to its module. */
import { closeCardPanel, setLayout, toggleCardExpand } from '../shared/job_list.js';
import { toggleFilterPop } from '../shared/shell.js';
import { clearFetchSelection, deleteSelectedJobs, fetchDetailsForSelected, fetchJobDetails, hideBatchBanner, onCardFetchSelect, runAiForJob, runAiForSelected, selectAllVisible, selectMissingAi, selectMissingDetails, selectVisibleRecommended, toggleSelectMode } from './batch.js';
import { addHighlightFromInput, addHighlightPreset, addQaItem, cancelEditInfo, deleteMatchedJob, openEditInfo, removeHighlight, removeQaItem, saveApplicationQa, saveJobInfo, saveNotes, saveReplaceLink } from './card-actions.js';
import { saveApplicantPosition } from './cards.js';
import { clearAppliedFilter, copyJobDescription, debounceLoad, filterByCompany, initTrackerPage, loadJobDescription, loadJobs, nextPage, onTimePresetChange, prevPage, refreshAll, setStatusFilter, showTrackerView, toggleHighlightsFilter, toggleStatsExpanded } from './index.js';
import { toggleLocBubble } from './overview/bubbles.js';
import { hideJourneyTip, showJourneyTip, toggleCompanyPop } from './overview/journey.js';
import { addTimelineStep, editTimelineStep, undoTimelineStep, updateSideStatus } from './timeline.js';

Object.assign(window, {
  addHighlightFromInput, addHighlightPreset, addQaItem, addTimelineStep, cancelEditInfo,
  clearAppliedFilter, clearFetchSelection, closeCardPanel, copyJobDescription, debounceLoad,
  deleteMatchedJob, deleteSelectedJobs, editTimelineStep, fetchDetailsForSelected,
  fetchJobDetails, filterByCompany, hideBatchBanner, hideJourneyTip, loadJobDescription,
  loadJobs, nextPage, onCardFetchSelect, onTimePresetChange, openEditInfo, prevPage, refreshAll,
  removeHighlight, removeQaItem, runAiForJob, runAiForSelected, saveApplicantPosition,
  saveApplicationQa, saveJobInfo, saveNotes, saveReplaceLink, selectAllVisible, selectMissingAi,
  selectMissingDetails, selectVisibleRecommended, setLayout, setStatusFilter, showJourneyTip,
  showTrackerView, toggleCardExpand, toggleCompanyPop, toggleFilterPop, toggleHighlightsFilter,
  toggleLocBubble, toggleSelectMode, toggleStatsExpanded, undoTimelineStep, updateSideStatus,
});

initTrackerPage();
