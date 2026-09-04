const VikunjaService = require('./vikunjaService');
const { createDailyLog, inferDate } = require('./geminiService');
const db = require('../db/database');
const { GoogleGenAI } = require('@google/genai');
const { toZonedTime, fromZonedTime } = require('date-fns-tz');
const { nextFriday, setHours, setMinutes, setSeconds, setMilliseconds } = require('date-fns');

/**
 * Generates the daily work log for a given date.
 * Handles cache lookups, Vikunja fetches, and Gemini formatting.
 * 
 * @param {string|null} dateInput - Natural language date or YYYY-MM-DD or null for today.
 * @returns {Promise<object>} Result containing displayDate, log content, and status flags.
 */
async function generateDailyLog(dateInput = null) {
  let targetDate;
  let displayDate;

  if (dateInput) {
    // If it's already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      targetDate = dateInput;
    } else {
      targetDate = await inferDate(dateInput);
    }

    if (!targetDate) {
      throw new Error(`Could not understand the date input: "${dateInput}".`);
    }

    const [year, month, day] = targetDate.split('-');
    displayDate = `${day}-${month}-${year}`;
  } else {
    const today = new Date();
    targetDate = today.toISOString().split('T')[0];
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    displayDate = `${day}-${month}-${year}`;
  }

  const todayDateStr = new Date().toISOString().split('T')[0];
  const isToday = (targetDate === todayDateStr);

  // 1. Check SQLite cache (only for past dates)
  if (!isToday) {
    const cachedLog = db.getDailyLog(targetDate);
    if (cachedLog) {
      return {
        cached: true,
        displayDate,
        targetDate,
        log: cachedLog.log_content
      };
    }
  }

  // 2. Fetch from Vikunja
  const vikunja = new VikunjaService();
  const tasks = await vikunja.getTasks();

  const inProgressBucketId = parseInt(process.env.VIKUNJA_BUCKET_INPROGRESS_ID, 10);
  const doneBucketId = parseInt(process.env.VIKUNJA_BUCKET_DONE_ID, 10);

  // Filter tasks completed on targetDate or currently in-progress
  const relevantTasks = tasks.filter(t => {
    const isCompletedOnDate = (t.done || t.bucket_id === doneBucketId) && 
        t.done_at && t.done_at.startsWith(targetDate);
    
    const isInProgressOnDate = t.bucket_id === inProgressBucketId;

    return isCompletedOnDate || isInProgressOnDate;
  });

  if (relevantTasks.length === 0) {
    return {
      noTasks: true,
      displayDate,
      targetDate
    };
  }

  const tasksWithData = relevantTasks.map(t => ({
    title: t.title,
    description: t.description || 'No description provided.',
    statusName: (t.done || t.bucket_id === doneBucketId) ? 'Done' : 'In Progress'
  }));

  // 3. Generate log using Gemini
  const dailyLog = await createDailyLog(tasksWithData, displayDate);
  if (!dailyLog) {
    throw new Error('Gemini failed to generate the daily work log.');
  }

  // 4. Save to cache
  db.saveDailyLog(targetDate, dailyLog);

  return {
    cached: false,
    displayDate,
    targetDate,
    log: dailyLog
  };
}

/**
 * Generates the weekly retrospective wrapup summary of tasks completed in the last 7 days.
 * Additionally:
 * 1. Extends active tasks (backlog, in-progress, paused) to next Friday at 6:00 PM.
 * 2. Clears the Done column by setting bucket_id to 0 for completed tasks, keeping it pristine without deletions.
 * 
 * @returns {Promise<object>} Result containing retrospective summary and statistics.
 */
async function generateWeeklyWrapup() {
  const vikunja = new VikunjaService();
  const tasks = await vikunja.getTasks();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const backlogBucketId = parseInt(process.env.VIKUNJA_BUCKET_BACKLOG_ID, 10);
  const inProgressBucketId = parseInt(process.env.VIKUNJA_BUCKET_INPROGRESS_ID, 10);
  const pausedBucketId = parseInt(process.env.VIKUNJA_BUCKET_PAUSED_ID, 10);
  const doneBucketId = parseInt(process.env.VIKUNJA_BUCKET_DONE_ID, 10);

  // Filter completed tasks for Gemini report
  const completedTasks = tasks.filter(t => {
    if (!(t.done || t.bucket_id === doneBucketId)) return false;
    if (!t.done_at) return false;
    const doneDate = new Date(t.done_at);
    return doneDate >= sevenDaysAgo;
  });

  // 1. EXTEND ACTIVE TASKS to next Friday at 6:00 PM
  const timezone = process.env.APP_TIMEZONE || 'Asia/Jakarta';
  const nowInTimezone = toZonedTime(new Date(), timezone);

  let targetFriday = nextFriday(nowInTimezone);
  targetFriday = setHours(targetFriday, 18);
  targetFriday = setMinutes(targetFriday, 0);
  targetFriday = setSeconds(targetFriday, 0);
  targetFriday = setMilliseconds(targetFriday, 0);
  const nextFridayISO = fromZonedTime(targetFriday, timezone).toISOString();

  // Find all active (non-done) tasks
  const activeTasks = tasks.filter(t => 
    !t.done && 
    (t.bucket_id === backlogBucketId || t.bucket_id === inProgressBucketId || t.bucket_id === pausedBucketId || t.bucket_id === 0 || !t.bucket_id)
  );

  let extendedCount = 0;
  for (const task of activeTasks) {
    try {
      await vikunja.updateTask(task.id, { due_date: nextFridayISO });
      extendedCount++;
    } catch (err) {
      console.error(`[Wrapup] Failed to extend active task #${task.id}:`, err.message);
    }
  }

  // 2. UNASSIGN COMPLETED TASKS from Kanban board to prevent overcrowding
  const doneTasks = tasks.filter(t => t.bucket_id === doneBucketId);
  let archivedCount = 0;
  for (const task of doneTasks) {
    try {
      // Set bucket_id to 0 to unassign it from any column on the Kanban board
      await vikunja.updateTask(task.id, { bucket_id: 0 });
      archivedCount++;
    } catch (err) {
      console.error(`[Wrapup] Failed to unassign done task #${task.id}:`, err.message);
    }
  }

  if (completedTasks.length === 0) {
    return {
      noTasks: true,
      extendedCount,
      archivedCount
    };
  }

  const taskListStr = completedTasks.map(t => `- ${t.title} (${t.description || 'No description'})`).join('\n');

  const prompt = `
  You are a professional performance coach assistant. Your user wants a weekly accomplishment wrapup.
  Below is a list of tasks they successfully completed in the past 7 days.
  Summarize these achievements into a beautiful, motivating, and professional report suitable for a weekly retrospective or self-review.
  
  Use bullet points and group similar accomplishments under logical headers (e.g., Development, Operations, Planning, etc.) if applicable.
  Keep it professional, encouraging, and clear. Use Markdown for formatting.
  
  Completed Tasks:
  ${taskListStr}
  
  Weekly Accomplishment Summary:
  `;

  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const modelName = process.env.GEMINI_GENERAL_MODEL || 'gemini-2.5-flash';
  const result = await genAI.models.generateContent({
      model: modelName,
      contents: prompt,
  });

  const summary = result.text;
  if (!summary) {
    throw new Error('Gemini failed to generate the weekly wrapup retrospective.');
  }

  return {
    summary,
    extendedCount,
    archivedCount
  };
}

module.exports = {
  generateDailyLog,
  generateWeeklyWrapup
};
