# Personal Habit Tracker

**Team Galacticos** · CA1 project · built with HTML, CSS and vanilla JavaScript only

**Live demo:** [ADD: your GitHub Pages link, for example https://your-username.github.io/your-repository/]

A personal habit tracker. Create habits, choose when they are due, tick them off each day, and review your progress over time with a dashboard, a history calendar, streaks and weekly and monthly summaries.

> **Local demo mode (prototype).** There are no accounts and no server. Profiles are only names that keep each person's habits separate inside one browser. They have no passwords and give no security. See [Security and limitations](#security-and-limitations).

## Screenshots

| Dashboard | Habits |
|---|---|
| ![Dashboard](screenshots/dashboard.png) | ![Habits](screenshots/habits.png) |

| History | Progress |
|---|---|
| ![History calendar](screenshots/history.png) | ![Progress](screenshots/progress.png) |

| Settings | Mobile view |
|---|---|
| ![Settings](screenshots/settings.png) | ![Mobile layout](screenshots/mobile.png) |

## Features

**Profiles and data**
- Create, open and delete local demo profiles. Each profile's data is stored under its own keys.
- Data is kept in the browser (`localStorage`) and survives refreshing and closing the browser.
- Export a profile's habits and completion history to a JSON file, and import it again. Imported files are checked and cleaned before anything is saved.

**Habit management**
- Create and edit habits with a name, description, category, priority (Low, Medium, High), start date and schedule.
- Schedules: every day, Monday to Friday, or any custom set of weekdays.
- Delete with a confirmation that says how many completion records will be removed with the habit.
- Validation with clear messages: empty names, over-long text, duplicate names (ignoring capitals and extra spaces), invalid dates, no days chosen.
- Editing a habit keeps its completion history.

**Completion**
- Tick a habit done for today, and undo it. There is never more than one record for the same habit and date.
- On the History page you can tick a missed habit or undo a tick for any past day. Future days cannot be ticked.

**Dashboard and progress**
- Active habits, habits scheduled today, done today, remaining today, daily completion percentage, best current streak and overall completion.
- Weekly progress chart (Monday to Sunday) with daily percentages, completed versus scheduled counts and a weekly completion rate.
- History: a month calendar with day-by-day detail, a month summary and a "go to date" box.
- Progress page: monthly summary, daily bar chart for the month, per-habit table, an 8-week trend chart and a streak table.
- Recent activity: a real log of habits created, updated, completed, un-completed and deleted. It records actions from the time this feature was added onward.
- All charts are drawn with plain HTML and CSS. No charting library is used.

**Search, filter and sort**
- Search by name or description (several words must all match).
- Filter by category, priority, status today and schedule. Sort by name, priority, newest, oldest or completion status.
- A "Reset all" button, and a live "Showing x of y habits" line.

**Reminders**
- Optional reminder time per habit. See [Reminders](#reminders) for what is and is not possible.

**Interface**
- Light and dark themes (follows the device by default and can be overridden).
- Responsive layout: sidebar on desktop, top bar and bottom tab bar on smaller screens.
- Accessibility: labelled form fields, error messages linked to their fields, a skip link, visible keyboard focus, arrow-key movement in the calendar, and reduced-motion support.

## Technology

- HTML5, CSS3 (custom properties, grid, flexbox) and vanilla JavaScript (ES modules).
- No frameworks, no libraries, no build step, no external services, no API keys.
- Browser features used: `localStorage`, the `<dialog>` element, the Notification API, `Intl`, and `Blob` downloads.
- System font stack, so nothing is loaded from the internet.

## Run it locally

The JavaScript uses ES modules, which browsers will not load when you double-click an HTML file. Use a local web server:

1. Open the project folder in VS Code and install the **Live Server** extension.
2. Right-click `index.html` and choose **Open with Live Server**.

Or, with Python installed, run this in the project folder and open `http://localhost:5500`:

```
python -m http.server 5500
```

## How it works

```
page-*.js   (one script per page: reads the screen, draws the result)
    |
    +-- habits.js     habit rules, validation, create / edit / delete / tick
    +-- stats.js      every statistic: streaks, week, month, overall, history
    +-- filters.js    search, filter and sort for the habit list
    +-- reminders.js  in-tab reminder checker and notification helpers
    |
    +-- auth.js       local demo profiles (not real authentication)
    +-- backup.js     export / import of one profile's data
            |
            v
        storage.js    the ONLY file that reads or writes app data in localStorage
```

`ui.js` holds the shared interface code (navigation, theme, dialogs, toasts, icons) and `dates.js` holds all date handling.

### Project structure

```
index.html  dashboard.html  habits.html  history.html  progress.html  settings.html
favicon.svg
css/   variables.css  base.css  layout.css  components.css  pages.css
       habits.css  insights.css  calendar.css
js/    theme-init.js  dates.js  storage.js  auth.js  backup.js  habits.js
       stats.js  filters.js  reminders.js  ui.js
       page-index.js  page-dashboard.js  page-habits.js  page-history.js
       page-progress.js  page-settings.js
```

### Data model

```
Profile    { id, displayName, createdAt }
Habit      { id, userId, name, description, category, priority,
             startDate, endDate | null,
             schedule: { type: 'daily' | 'weekdays', days: [0-6] },   // 0 = Sunday
             reminder: { enabled, time: 'HH:MM' },
             archived, createdAt, updatedAt }
Completion { id, habitId, userId, date: 'YYYY-MM-DD', completedAt }
```

A completion record exists only while a habit is done on that date. "Missed" is never stored; it is calculated.

### Where data is stored

Everything is in `localStorage`, under keys that start with `habitTracker:`:

| Key | Contents |
|---|---|
| `habitTracker:schemaVersion` | Data format version |
| `habitTracker:profiles` | List of profiles |
| `habitTracker:activeProfile` | The profile that is open |
| `habitTracker:theme` | Light, dark or device default |
| `habitTracker:<userId>:habits` | That profile's habits |
| `habitTracker:<userId>:completions` | That profile's completion records |
| `habitTracker:<userId>:activity` | That profile's recent activity (newest 200 entries) |
| `habitTracker:<userId>:reminderLog` | Which reminders were already shown today |

### Counting rules

- **Scheduled day:** a day on or after the habit's start date (and not after its end date) whose weekday is one of the habit's chosen days.
- **Active habit:** not archived, already started, and not ended.
- **Completion percentage:** completed scheduled days divided by scheduled days, rounded. If nothing was scheduled, a dash is shown instead of a number, so there is never a division by zero.
- **Missed:** a scheduled day before today with no completion. Today's unfinished habits count as "remaining", not missed. Days when a habit is not scheduled are never counted as missed.
- **Current streak:** consecutive scheduled days completed, counted back from today. Unscheduled days are skipped and never break a streak. If today is scheduled but not done yet, the streak is not broken until the day ends.
- **Best streak:** the longest such run in the habit's history.
- **Dates:** every date is a local calendar day written as `YYYY-MM-DD`. Day arithmetic uses calendar dates, so daylight-saving changes cannot move a completion to a different day.

## Reminders

- **While the app is open in a browser tab**, it checks every 30 seconds. A habit is reminded once per day when its reminder time has passed, it is scheduled today and it is not done yet. You always get a message inside the app. A browser pop-up is also shown if you allowed notifications in Settings.
- **If you open the app after a reminder time has passed** and the habit is still not done, you get that reminder once when the page loads. This includes a habit created with a reminder time that has already passed today.
- **When the tab or browser is closed, nothing happens.** Reminders for a closed browser would need a service worker and a push server, which this project does not have.
- Browsers slow down background tabs, so a reminder can arrive a little late. Some phone browsers do not allow notifications from web pages. Notifications need `https` or `localhost`.

## Security and limitations

- **Profiles are not authentication.** There are no passwords. Anyone using the same browser can open any profile, and anyone with the browser's developer tools can read and edit all saved data.
- **Data stays in one browser.** It is not sent anywhere, does not sync between devices, and is lost if the site's data is cleared. Use **Export backup** in Settings to keep a copy.
- **A deployed copy starts empty for every visitor.** Browsers keep storage separately for each web address, so data created on `localhost` does not appear on the live site.
- Real multi-user accounts would need a server and a database, which are outside the scope of an HTML, CSS and JavaScript project.
- The app does not remember old schedules. If a habit's schedule is changed, past statistics are recalculated with the new schedule, and completions on days that are no longer scheduled are kept but not counted.
- There is no screen for ending or archiving a habit. Those fields exist in the data model and are respected when present (for example in an imported file).
- Export files contain habits and completion records only. The recent activity list and reminder history are not included.
- Search and filter choices are not saved when you leave a page.
- User-entered text is always escaped before it is shown, and imported files are validated field by field.

## Testing

No automated test suite is included. The app was checked manually in the browser using a written checklist covering profiles, creating, editing and deleting habits, validation and duplicates, completion and undo, dashboard figures, streaks for daily, weekday and custom schedules, weekly and monthly progress, search, filters and sorting together, empty states, long names and special characters, invalid dates, damaged stored data, responsive layouts, keyboard use and reminders.

Browsers used for testing: Chrome Version 156.0.8078.80

## Acknowledgements

Team: Singh Utkarsh Shibendu,Raunak Kumar Pandey,Borra Sai Kiran

This project was developed with the help of an AI assistant (Claude, by Anthropic).
#   p e r s o n a l - h a b i t - t r a c k e r  
 