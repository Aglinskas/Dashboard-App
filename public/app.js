// AURA PRODUCTIVITY DASHBOARD ENGINE

// App State
let summaryData = null;
let currentDayDetails = null;
let activeDate = null;
let categoryMeta = {};
let zoomLevel = 1.0;
let isDragging = false;
let startX = 0;

// Daily Goal (8 hours in seconds)
const DAILY_GOAL_SECONDS = 8 * 3600;

// Helper: Format Duration (e.g., 3600 -> "1h 0m", 120 -> "2m 0s")
function formatDuration(seconds) {
    if (seconds <= 0 || isNaN(seconds)) return "0m";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    
    if (h > 0) {
        return `${h}h ${m}m`;
    } else if (m > 0) {
        return `${m}m ${s}s`;
    } else {
        return `${s}s`;
    }
}

// Helper: Get Day abbreviation
function getDayAbbr(dateStr) {
    const d = new Date(dateStr);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[d.getDay()];
}

// Helper: Get Month Day label (e.g., "Jun 5")
function formatMonthDay(dateStr) {
    const d = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
}

// Calculate Productivity Score (0 - 100)
function calculateProductivityScore(categories) {
    const weights = {
        "Coding / Dev": 1.0,
        "Design / Media": 0.9,
        "Work / Writing / Office": 0.8,
        "Browsing / Research": 0.6,
        "System / Idle": 0.4,
        "Entertainment / Social": 0.15
    };
    
    let totalSec = 0;
    let weightedSec = 0;
    
    for (const [cat, data] of Object.entries(categories)) {
        const sec = data.seconds;
        const weight = weights[cat] || 0.5;
        totalSec += sec;
        weightedSec += (sec * weight);
    }
    
    if (totalSec === 0) return 0;
    return Math.round((weightedSec / totalSec) * 100);
}

// Init Calendar Strip Selector
function renderCalendarStrip(days, activeDate) {
    const container = document.getElementById('calendar-strip');
    container.innerHTML = '';
    
    // Sort dates chronologically
    const sortedDates = Object.keys(days).sort();
    
    sortedDates.forEach(dateStr => {
        const stats = days[dateStr];
        const dayItem = document.createElement('div');
        dayItem.className = `calendar-day-item ${dateStr === activeDate ? 'active' : ''}`;
        dayItem.setAttribute('data-date', dateStr);
        
        // Calculate activity fill percentage relative to a max (say 10 hours for visual scaling)
        const maxScaleSeconds = 10 * 3600;
        const fillPercent = Math.min(100, (stats.active_seconds / maxScaleSeconds) * 100);
        
        const hoursActive = stats.active_seconds / 3600.0;
        
        dayItem.innerHTML = `
            <span class="day-name">${getDayAbbr(dateStr)}</span>
            <span class="day-date">${dateStr.slice(-2)}</span>
            <div class="day-activity-spark">
                <div class="day-activity-fill" style="width: ${fillPercent}%; ${fillPercent === 0 ? 'display: none;' : ''}"></div>
            </div>
            <span class="day-total-hours">${hoursActive.toFixed(1)}h</span>
        `;
        
        dayItem.addEventListener('click', () => {
            // Set active class
            document.querySelectorAll('.calendar-day-item').forEach(item => {
                item.classList.remove('active');
            });
            dayItem.classList.add('active');
            
            loadDayDetails(dateStr);
        });
        
        container.appendChild(dayItem);
    });
    
    // Auto scroll the calendar strip to the right (latest day)
    setTimeout(() => {
        container.scrollLeft = container.scrollWidth;
    }, 100);
}

// Update Top Stats & Hero Cards
function updateStatsAndHero(details) {
    // 1. Title Date
    document.getElementById('active-date-title').textContent = formatMonthDay(details.date) + `, ${details.date.slice(0, 4)}`;
    
    // 2. Active Time Value
    const activeSec = details.active_seconds;
    document.getElementById('stat-active-time').textContent = formatDuration(activeSec);
    
    // 3. Progress Ring Circle
    const circle = document.getElementById('progress-ring-circle');
    const circumference = 596.9; // 2 * pi * r (r=95)
    const goalPercent = Math.min(1, activeSec / DAILY_GOAL_SECONDS);
    const strokeDashoffset = circumference - (goalPercent * circumference);
    circle.style.strokeDashoffset = strokeDashoffset;
    
    // 4. Goal text
    const goalPercentText = Math.round(goalPercent * 100);
    document.getElementById('stat-goal-percent').textContent = `${goalPercentText}%`;
    
    // 5. Total Events (Combined Computer + Phone)
    const desktopEventsCount = details.timeline ? details.timeline.length : 0;
    const phoneEventsCount = details.iphone_timeline ? details.iphone_timeline.length : 0;
    document.getElementById('stat-events-count').textContent = (desktopEventsCount + phoneEventsCount).toLocaleString();
    
    // 6. Top Category Details
    let topCat = "N/A";
    let topCatTime = 0;
    
    Object.entries(details.categories).forEach(([name, data]) => {
        if (data.seconds > topCatTime) {
            topCat = name;
            topCatTime = data.seconds;
        }
    });
    
    document.getElementById('stat-top-category').textContent = topCat.split(' / ')[0];
    document.getElementById('stat-top-cat-time').textContent = `${formatDuration(topCatTime)} logged`;

    // 7. Phone Screen Time Value
    const phoneSec = details.iphone_active_seconds || 0;
    document.getElementById('stat-phone-time').textContent = formatDuration(phoneSec);
    
    // 8. Productivity Score
    const score = calculateProductivityScore(details.categories);
    document.getElementById('stat-productivity-score').textContent = score;
}

// Render the centerpiece horizontal timeline
function renderTimeline(desktopEvents, iphoneEvents, dateStr) {
    const desktopContainer = document.getElementById('timeline-bars');
    const phoneContainer = document.getElementById('timeline-bars-phone');
    const hoursContainer = document.getElementById('timeline-hours');
    
    desktopContainer.innerHTML = '';
    phoneContainer.innerHTML = '';
    hoursContainer.innerHTML = '';
    
    // Reset Zoom
    const timelineCanvas = document.getElementById('timeline-canvas');
    if (timelineCanvas) {
        timelineCanvas.style.width = '100%';
    }
    zoomLevel = 1.0;
    
    // Setup hour markers (00:00 to 23:00)
    for (let h = 0; h < 24; h++) {
        const marker = document.createElement('div');
        marker.className = 'hour-line';
        marker.setAttribute('data-hour', `${h.toString().padStart(2, '0')}:00`);
        hoursContainer.appendChild(marker);
    }
    
    // Timeline Inspect Hover Handlers
    const inspector = document.getElementById('timeline-inspector');
    const inspectPlaceholder = inspector.querySelector('.inspect-placeholder');
    const inspectDetails = inspector.querySelector('.inspect-details');
    
    const inspectTime = document.getElementById('inspect-time');
    const inspectApp = document.getElementById('inspect-app');
    const inspectCategory = document.getElementById('inspect-category');
    const inspectDuration = document.getElementById('inspect-duration');
    const inspectTitle = document.getElementById('inspect-title');
    
    // Start of the day (00:00:00) local time
    const startOfDay = new Date(`${dateStr}T00:00:00`);
    
    const renderLaneEvents = (events, container) => {
        if (!events) return;
        events.forEach(e => {
            const evStart = new Date(e.start);
            
            // Calculate offset in seconds relative to start of day
            const offsetSec = (evStart.getTime() - startOfDay.getTime()) / 1000.0;
            const durSec = e.duration;
            
            // Express as percentages of 24h (86,400 seconds)
            const leftPercent = (offsetSec / 86400.0) * 100;
            const widthPercent = (durSec / 86400.0) * 100;
            
            // Ensure bounds
            if (leftPercent < 0 || leftPercent >= 100) return;
            const boundedWidth = Math.min(100 - leftPercent, widthPercent);
            
            const block = document.createElement('div');
            block.className = 'timeline-event-block';
            block.style.left = `${leftPercent}%`;
            block.style.width = `${boundedWidth}%`;
            block.style.backgroundColor = e.color;
            block.style.color = e.color; // for hover shadow glow in CSS
            
            // Hover interactions
            block.addEventListener('mouseenter', () => {
                // Show detailed inspection panel
                inspectPlaceholder.style.display = 'none';
                inspectDetails.style.display = 'flex';
                
                // Format time range
                const formatTime = dt => {
                    const d = new Date(dt);
                    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
                };
                
                inspectTime.textContent = `${formatTime(e.start)} - ${formatTime(e.end)}`;
                inspectApp.textContent = e.app;
                inspectCategory.textContent = e.category;
                inspectCategory.style.color = e.color;
                inspectDuration.textContent = formatDuration(e.duration);
                
                // Window title or web tab title/URL
                let displayTitle = e.title;
                if (e.web_title) {
                    displayTitle = `${e.web_title} (${e.url})`;
                } else if (e.url) {
                    displayTitle = e.url;
                }
                inspectTitle.textContent = displayTitle || "(No Window Title Logged)";
            });
            
            block.addEventListener('mouseleave', () => {
                // Reset to instructions placeholder
                inspectPlaceholder.style.display = 'flex';
                inspectDetails.style.display = 'none';
            });
            
            container.appendChild(block);
        });
    };
    
    renderLaneEvents(desktopEvents, desktopContainer);
    renderLaneEvents(iphoneEvents, phoneContainer);
}

// Render Analytics: Category Distribution bars
function renderCategories(categories, totalSeconds) {
    const container = document.getElementById('category-distribution-list');
    container.innerHTML = '';
    
    // Sort categories by time spent
    const sortedCats = Object.entries(categories).sort((a, b) => b[1].seconds - a[1].seconds);
    
    sortedCats.forEach(([name, data]) => {
        const percent = totalSeconds > 0 ? (data.seconds / totalSeconds) * 100 : 0;
        
        const row = document.createElement('div');
        row.className = 'category-row';
        row.innerHTML = `
            <div class="category-row-header">
                <div style="display: flex; align-items: center;">
                    <span class="cat-name-lbl">${name}</span>
                    <span class="category-chevron">▼</span>
                </div>
                <span class="cat-duration-lbl">${formatDuration(data.seconds)} (${percent.toFixed(0)}%)</span>
            </div>
            <div class="category-progress-track">
                <div class="category-progress-bar" style="background: ${data.color}; width: 0%"></div>
            </div>
            <div class="category-expansion-panel"></div>
        `;
        
        // Handle expand on click
        row.addEventListener('click', (e) => {
            // Ignore click if it is on an item inside the expansion panel
            if (e.target.closest('.sub-list-item')) return;
            
            const isExpanded = row.classList.toggle('expanded');
            if (isExpanded) {
                populateCategoryExpansion(row, name, data.color);
            }
        });
        
        container.appendChild(row);
        
        // Trigger fill animation
        setTimeout(() => {
            row.querySelector('.category-progress-bar').style.width = `${percent}%`;
        }, 100);
    });
}

// Populate Category Detail Sub-list (Apps & Websites) on Expand
function populateCategoryExpansion(row, name, color) {
    const panel = row.querySelector('.category-expansion-panel');
    panel.innerHTML = '';
    
    const cleanUrl = (url) => {
        try {
            const hostname = new URL(url).hostname;
            return hostname.startsWith('www.') ? hostname.substring(4) : hostname;
        } catch (err) {
            return url.split('/')[0] || url;
        }
    };
    
    const appSums = {};
    const webSums = {};
    
    // Aggregate computer apps & websites
    if (currentDayDetails.timeline) {
        currentDayDetails.timeline.forEach(e => {
            if (e.category === name) {
                if (e.app) {
                    const key = `💻 ${e.app}`;
                    appSums[key] = (appSums[key] || 0.0) + e.duration;
                }
                if (e.url) {
                    const domain = cleanUrl(e.url);
                    if (domain) {
                        webSums[domain] = (webSums[domain] || 0.0) + e.duration;
                    }
                }
            }
        });
    }

    // Aggregate iOS apps
    if (currentDayDetails.iphone_timeline) {
        currentDayDetails.iphone_timeline.forEach(e => {
            if (e.category === name) {
                if (e.app) {
                    const key = `📱 ${e.app}`;
                    appSums[key] = (appSums[key] || 0.0) + e.duration;
                }
            }
        });
    }
    
    const sortedApps = Object.entries(appSums).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const sortedWeb = Object.entries(webSums).sort((a, b) => b[1] - a[1]).slice(0, 5);
    
    if (sortedApps.length === 0 && sortedWeb.length === 0) {
        panel.innerHTML = `<div style="font-size: 0.7rem; color: var(--text-muted); padding: 4px 0;">No active logs in this category.</div>`;
        return;
    }
    
    // Render Apps
    if (sortedApps.length > 0) {
        const subHeader = document.createElement('div');
        subHeader.style.cssText = 'font-size: 0.6rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin: 4px 0 2px 0;';
        subHeader.textContent = "Apps";
        panel.appendChild(subHeader);
        
        sortedApps.forEach(([app, sec]) => {
            const item = document.createElement('div');
            item.className = 'sub-list-item';
            item.style.color = color;
            item.innerHTML = `
                <span class="sub-item-name" title="${app}">${app}</span>
                <span class="sub-item-time">${formatDuration(sec)}</span>
            `;
            panel.appendChild(item);
        });
    }
    
    // Render Websites
    if (sortedWeb.length > 0) {
        const subHeader = document.createElement('div');
        subHeader.style.cssText = 'font-size: 0.6rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin: 8px 0 2px 0;';
        subHeader.textContent = "Websites";
        panel.appendChild(subHeader);
        
        sortedWeb.forEach(([domain, sec]) => {
            const item = document.createElement('div');
            item.className = 'sub-list-item';
            item.style.color = color;
            item.innerHTML = `
                <span class="sub-item-name" title="${domain}">🌐 ${domain}</span>
                <span class="sub-item-time">${formatDuration(sec)}</span>
            `;
            panel.appendChild(item);
        });
    }
}

// Render Analytics: Top Apps list
function renderTopApps(topApps, maxAppSeconds) {
    const container = document.getElementById('top-apps-list');
    container.innerHTML = '';
    
    if (!topApps || topApps.length === 0) {
        container.innerHTML = '<div class="calendar-loading">No application activity recorded.</div>';
        return;
    }
    
    // The first app has the highest seconds (scale factor)
    const scaleMax = maxAppSeconds || topApps[0].seconds;
    
    topApps.forEach((item, index) => {
        const barPercent = scaleMax > 0 ? (item.seconds / scaleMax) * 100 : 0;
        const listItem = document.createElement('div');
        listItem.className = 'list-item';
        
        listItem.innerHTML = `
            <div class="item-left">
                <span class="item-rank">#${index + 1}</span>
                <span class="item-color-indicator" style="background: ${item.color}; box-shadow: 0 0 6px ${item.color}"></span>
                <span class="item-name" title="${item.app}">${item.app}</span>
            </div>
            <div class="item-right">
                <div class="item-bar-mini">
                    <div class="item-bar-fill" style="background: ${item.color}; width: 0%"></div>
                </div>
                <span class="item-time">${formatDuration(item.seconds)}</span>
            </div>
        `;
        
        container.appendChild(listItem);
        
        // Trigger fill animation
        setTimeout(() => {
            const fill = listItem.querySelector('.item-bar-fill');
            if (fill) fill.style.width = `${barPercent}%`;
        }, 100);
    });
}

// Render Analytics: Top iOS Apps list
function renderTopIosApps(topIosApps, maxAppSeconds) {
    const container = document.getElementById('top-ios-apps-list');
    container.innerHTML = '';
    
    if (!topIosApps || topIosApps.length === 0) {
        container.innerHTML = '<div class="calendar-loading">No iOS app activity recorded.</div>';
        return;
    }
    
    // The first app has the highest seconds (scale factor)
    const scaleMax = maxAppSeconds || topIosApps[0].seconds;
    
    topIosApps.forEach((item, index) => {
        const barPercent = scaleMax > 0 ? (item.seconds / scaleMax) * 100 : 0;
        const listItem = document.createElement('div');
        listItem.className = 'list-item';
        
        listItem.innerHTML = `
            <div class="item-left">
                <span class="item-rank">#${index + 1}</span>
                <span class="item-color-indicator" style="background: ${item.color}; box-shadow: 0 0 6px ${item.color}"></span>
                <span class="item-name" title="${item.app}">${item.app}</span>
            </div>
            <div class="item-right">
                <div class="item-bar-mini">
                    <div class="item-bar-fill" style="background: ${item.color}; width: 0%"></div>
                </div>
                <span class="item-time">${formatDuration(item.seconds)}</span>
            </div>
        `;
        
        container.appendChild(listItem);
        
        // Trigger fill animation
        setTimeout(() => {
            const fill = listItem.querySelector('.item-bar-fill');
            if (fill) fill.style.width = `${barPercent}%`;
        }, 100);
    });
}

// Helper: Extract domain from URL (Global helper)
function cleanUrl(url) {
    if (!url) return "";
    try {
        let domain = "";
        if (url.includes("://")) {
            domain = new URL(url).hostname;
        } else {
            domain = new URL("http://" + url).hostname;
        }
        return domain.startsWith('www.') ? domain.substring(4) : domain;
    } catch (err) {
        let clean = url.split('/')[0] || url;
        return clean.startsWith('www.') ? clean.substring(4) : clean;
    }
}

// Open and populate event details modal
function openDetailsModal(name, isFallback) {
    const modal = document.getElementById('details-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalStats = document.getElementById('modal-stats-summary');
    const modalBody = document.getElementById('modal-body');
    
    if (!modal || !currentDayDetails) return;
    
    // Set title name
    modalTitle.textContent = isFallback ? `Window Title Log Details` : `Domain Log Details`;
    
    // Filter matching events
    const timeline = currentDayDetails.timeline || [];
    const matchedEvents = timeline.filter(e => {
        if (isFallback) {
            return e.title === name;
        } else {
            return e.url && cleanUrl(e.url) === name;
        }
    });
    
    // Sort chronologically by start time
    matchedEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
    
    // Calculate stats
    const count = matchedEvents.length;
    const totalSec = matchedEvents.reduce((acc, e) => acc + e.duration, 0);
    
    modalStats.textContent = `${count} ${count === 1 ? 'entry' : 'entries'} found today • Total duration: ${formatDuration(totalSec)}`;
    
    // Clear and build body
    modalBody.innerHTML = '';
    
    if (count === 0) {
        modalBody.innerHTML = `<div class="timeline-empty-state">No matching event logs found.</div>`;
    } else {
        const timelineContainer = document.createElement('div');
        timelineContainer.className = 'modal-timeline';
        
        // Use name as indicator color badge
        const headerBadge = document.createElement('div');
        headerBadge.style.cssText = 'font-size: 1.1rem; font-weight: 700; font-family: var(--font-heading); color: var(--text-primary); margin-bottom: 20px; word-break: break-all;';
        headerBadge.innerHTML = isFallback ? `🎬 <span style="color: var(--clr-work);">${name}</span>` : `🌐 <span style="color: var(--clr-browsing);">${name}</span>`;
        modalBody.appendChild(headerBadge);
        
        matchedEvents.forEach(e => {
            const timelineItem = document.createElement('div');
            timelineItem.className = 'timeline-item';
            
            const start = new Date(e.start);
            const end = new Date(e.end);
            const formatTime = d => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
            const timeStr = `${formatTime(start)} - ${formatTime(end)}`;
            
            const color = e.color || 'var(--clr-browsing)';
            
            let contentHTML = '';
            if (isFallback) {
                contentHTML = `
                    <div class="timeline-card-content">
                        <div class="timeline-web-title">${e.title || '(Untitled Window)'}</div>
                    </div>
                `;
            } else {
                contentHTML = `
                    <div class="timeline-card-content">
                        <div class="timeline-web-title">${e.web_title || e.title || '(No page title)'}</div>
                        <a href="${e.url}" target="_blank" rel="noopener noreferrer" class="timeline-url-link" title="Open page in new tab">
                            ${e.url}
                        </a>
                    </div>
                `;
            }
            
            timelineItem.innerHTML = `
                <div class="timeline-node" style="background: ${color}; box-shadow: 0 0 6px ${color}"></div>
                <div class="timeline-header">
                    <span class="timeline-time-range">${timeStr}</span>
                    <div class="timeline-meta-row">
                        <span class="timeline-dur-tag">${formatDuration(e.duration)}</span>
                        <span class="timeline-app-tag">${e.app} (${e.host})</span>
                    </div>
                </div>
                ${contentHTML}
            `;
            
            timelineContainer.appendChild(timelineItem);
        });
        
        modalBody.appendChild(timelineContainer);
    }
    
    // Show Modal
    modal.showModal();
}

// Render Analytics: Top Web Domains list (or fallback window list)
function renderTopWeb(topDomains, timelineEvents, totalSeconds) {
    const container = document.getElementById('top-web-list');
    const warning = document.getElementById('web-data-warning');
    container.innerHTML = '';
    
    // If we have actual browser tab domains, render those
    if (topDomains && topDomains.length > 0) {
        warning.style.display = 'none';
        const maxWebSec = topDomains[0].seconds;
        
        topDomains.forEach((item, index) => {
            const barPercent = maxWebSec > 0 ? (item.seconds / maxWebSec) * 100 : 0;
            const listItem = document.createElement('div');
            listItem.className = 'list-item';
            
            listItem.innerHTML = `
                <div class="item-left">
                    <span class="item-rank">#${index + 1}</span>
                    <span class="item-color-indicator" style="background: var(--clr-browsing); box-shadow: 0 0 6px var(--clr-browsing)"></span>
                    <span class="item-name" title="${item.domain}">${item.domain}</span>
                </div>
                <div class="item-right">
                    <div class="item-bar-mini">
                        <div class="item-bar-fill" style="background: var(--clr-browsing); width: 0%"></div>
                    </div>
                    <span class="item-time">${formatDuration(item.seconds)}</span>
                </div>
            `;
            
            listItem.addEventListener('click', () => {
                openDetailsModal(item.domain, false);
            });
            
            container.appendChild(listItem);
            setTimeout(() => {
                listItem.querySelector('.item-bar-fill').style.width = `${barPercent}%`;
            }, 100);
        });
    } else {
        // Fallback: If no browser tab info exists (e.g. later days), show top active window titles
        warning.style.display = 'block';
        
        // Process window titles: group by window title and count durations
        const titleDurations = {};
        timelineEvents.forEach(e => {
            const t = e.title || "(Untitled Window)";
            // Ignore blank or utility system app window titles to make fallback interesting
            if (t && e.app !== 'loginwindow' && e.app !== 'Finder' && e.app !== 'UserNotificationCenter') {
                titleDurations[t] = (titleDurations[t] || 0.0) + e.duration;
            }
        });
        
        const sortedTitles = sortedEntries = Object.entries(titleDurations)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
            
        if (sortedTitles.length === 0) {
            container.innerHTML = '<div class="calendar-loading">No browser or title details available.</div>';
            return;
        }
        
        const scaleMax = sortedTitles[0][1];
        
        sortedTitles.forEach(([title, seconds], index) => {
            const barPercent = scaleMax > 0 ? (seconds / scaleMax) * 100 : 0;
            const listItem = document.createElement('div');
            listItem.className = 'list-item';
            
            listItem.innerHTML = `
                <div class="item-left">
                    <span class="item-rank">#${index + 1}</span>
                    <span class="item-color-indicator" style="background: var(--clr-work); box-shadow: 0 0 6px var(--clr-work)"></span>
                    <span class="item-name" title="${title}">${title}</span>
                </div>
                <div class="item-right">
                    <div class="item-bar-mini">
                        <div class="item-bar-fill" style="background: var(--clr-work); width: 0%"></div>
                    </div>
                    <span class="item-time">${formatDuration(seconds)}</span>
                </div>
            `;
            
            listItem.addEventListener('click', () => {
                openDetailsModal(title, true);
            });
            
            container.appendChild(listItem);
            setTimeout(() => {
                listItem.querySelector('.item-bar-fill').style.width = `${barPercent}%`;
            }, 100);
        });
    }
}

// Fetch and load details for selected day
function loadDayDetails(dateStr) {
    document.getElementById('loading-overlay').style.opacity = '1';
    document.getElementById('loading-overlay').style.pointerEvents = 'all';
    
    activeDate = dateStr;
    
    fetch(`/api/day?date=${dateStr}`)
        .then(res => res.json())
        .then(details => {
            currentDayDetails = details;
            
            // Render everything
            updateStatsAndHero(details);
            renderTimeline(details.timeline, details.iphone_timeline, details.date);
            renderCategories(details.categories, details.active_seconds + (details.iphone_active_seconds || 0));
            renderTopApps(details.top_apps);
            renderTopIosApps(details.top_ios_apps);
            renderTopWeb(details.top_domains, details.timeline, details.active_seconds);
            
            // Reveal dashboard views
            document.getElementById('dashboard-view').style.display = 'flex';
            
            // Fade out loader
            setTimeout(() => {
                document.getElementById('loading-overlay').style.opacity = '0';
                document.getElementById('loading-overlay').style.pointerEvents = 'none';
            }, 300);
        })
        .catch(err => {
            console.error("Error loading day details:", err);
            alert("Failed to load details for the selected day.");
            document.getElementById('loading-overlay').style.opacity = '0';
            document.getElementById('loading-overlay').style.pointerEvents = 'none';
        });
}

// Fetch summary on load
function loadDashboardSummary() {
    fetch('/api/summary')
        .then(res => res.json())
        .then(data => {
            summaryData = data;
            categoryMeta = data.categories_meta;
            
            // Set active day to latest day with data
            const latest = data.latest_date;
            activeDate = latest;
            
            // Render selector strip
            renderCalendarStrip(data.days, latest);
            
            // Fetch latest day's detail
            loadDayDetails(latest);
        })
        .catch(err => {
            console.error("Error loading dashboard summary:", err);
            document.querySelector('.spinner-status').textContent = "Failed to sync. Is server.py running?";
            document.querySelector('.aura-spinner').style.borderTopColor = 'var(--clr-design)';
            document.querySelector('.aura-spinner').style.animationPlayState = 'paused';
        });
}

// Start
document.addEventListener('DOMContentLoaded', () => {
    loadDashboardSummary();
    
    // Refresh Data Toggle Dropdown & Progress handler
    const refreshBtn = document.getElementById('refresh-btn');
    const refreshDropdown = document.getElementById('refresh-dropdown-menu');
    const refreshNowBtn = document.getElementById('refresh-now-btn');
    const refreshConfigView = document.getElementById('refresh-config-view');
    const refreshProgressView = document.getElementById('refresh-progress-view');
    const progressStepsList = document.getElementById('progress-steps-list');
    
    const refreshComputerChk = document.getElementById('refresh-computer');
    const refreshIphoneChk = document.getElementById('refresh-iphone');

    // Click to Toggle Dropdown
    if (refreshBtn && refreshDropdown) {
        refreshBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent immediate closing from document click
            
            // Toggle dropdown
            const isShown = refreshDropdown.classList.toggle('show');
            
            if (isShown) {
                // Always reset to config view on open
                if (refreshConfigView) refreshConfigView.style.display = 'block';
                if (refreshProgressView) refreshProgressView.style.display = 'none';
            }
        });
    }

    // Dismiss dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (refreshDropdown && refreshDropdown.classList.contains('show')) {
            const container = document.querySelector('.refresh-container');
            if (container && !container.contains(e.target)) {
                refreshDropdown.classList.remove('show');
            }
        }
    });

    // Handle "Refresh Now" Trigger
    if (refreshNowBtn && refreshDropdown && refreshConfigView && refreshProgressView && progressStepsList) {
        refreshNowBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent closing the dropdown on button click

            const refreshComputer = refreshComputerChk ? refreshComputerChk.checked : true;
            const refreshIphone = refreshIphoneChk ? refreshIphoneChk.checked : true;

            if (!refreshComputer && !refreshIphone) {
                alert("Please select at least one data source to refresh.");
                return;
            }

            // Switch to progress view
            refreshConfigView.style.display = 'none';
            refreshProgressView.style.display = 'block';

            // Populate initial progress list matching requested format
            progressStepsList.innerHTML = `
                <div class="step-row" id="step-computer">
                    <div class="step-label">
                        <span class="step-title">Refreshing Computer Use data</span>
                        <span class="step-status ${refreshComputer ? 'running' : 'skipped'}">
                            ${refreshComputer ? 'Refreshing...' : 'Skipped'}
                        </span>
                    </div>
                </div>
                <div class="step-row" id="step-iphone">
                    <div class="step-label">
                        <span class="step-title">Refreshing iPhone Use data</span>
                        <span class="step-status ${refreshIphone ? 'pending' : 'skipped'}">
                            ${refreshIphone ? 'Pending...' : 'Skipped'}
                        </span>
                    </div>
                </div>
            `;

            // Make the post request
            fetch('/api/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ computer: refreshComputer, iphone: refreshIphone })
            })
            .then(res => res.json())
            .then(data => {
                console.log("Selective refresh API response:", data);
                const results = data.results || {};

                // Update Computer Step Row
                if (refreshComputer) {
                    const compResult = results.computer || {};
                    const compRow = document.getElementById('step-computer');
                    if (compRow) {
                        const statusSpan = compRow.querySelector('.step-status');
                        statusSpan.className = `step-status ${compResult.status === 'done' ? 'done' : 'error'}`;
                        statusSpan.textContent = compResult.status === 'done' ? 'Done' : 'Error';
                        
                        if (compResult.status === 'error') {
                            const desc = document.createElement('div');
                            desc.className = 'step-desc';
                            desc.textContent = compResult.message || 'Error syncing data.';
                            compRow.appendChild(desc);
                        }
                    }
                }

                // Update iPhone Step Row
                if (refreshIphone) {
                    const iphoneRow = document.getElementById('step-iphone');
                    if (iphoneRow) {
                        const statusSpan = iphoneRow.querySelector('.step-status');
                        statusSpan.className = 'step-status running';
                        statusSpan.textContent = 'Refreshing...';
                    }

                    // Delay slightly for smooth transitions
                    setTimeout(() => {
                        const iphoneResult = results.iphone || {};
                        if (iphoneRow) {
                            const statusSpan = iphoneRow.querySelector('.step-status');
                            statusSpan.className = `step-status ${iphoneResult.status === 'done' ? 'done' : 'error'}`;
                            statusSpan.textContent = iphoneResult.status === 'done' ? 'Done' : 'Error';
                            
                            if (iphoneResult.status === 'error') {
                                const desc = document.createElement('div');
                                desc.className = 'step-desc';
                                desc.textContent = iphoneResult.message || 'Error syncing database.';
                                iphoneRow.appendChild(desc);
                            }
                        }
                    }, 600);
                }

                // Trigger reload if successful
                if (data.status === 'success') {
                    loadDashboardSummary();
                }

                // Auto Close the dropdown card after 1.5 seconds
                setTimeout(() => {
                    refreshDropdown.classList.remove('show');
                }, 1800);
            })
            .catch(err => {
                console.error("Refresh POST error:", err);
                
                // Mark active rows as error
                if (refreshComputer) {
                    const compRow = document.getElementById('step-computer');
                    if (compRow) {
                        const statusSpan = compRow.querySelector('.step-status');
                        statusSpan.className = 'step-status error';
                        statusSpan.textContent = 'Error';
                    }
                }
                if (refreshIphone) {
                    const iphoneRow = document.getElementById('step-iphone');
                    if (iphoneRow) {
                        const statusSpan = iphoneRow.querySelector('.step-status');
                        statusSpan.className = 'step-status error';
                        statusSpan.textContent = 'Error';
                    }
                }

                // Auto Close after error as well
                setTimeout(() => {
                    refreshDropdown.classList.remove('show');
                }, 2500);
            });
        });
    }
    
    // Modal Close handlers
    const modal = document.getElementById('details-modal');
    const modalCloseBtn = document.getElementById('modal-close');
    
    if (modal && modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => {
            modal.close();
        });
        
        // Close modal if clicking outside the modal content (backdrop click)
        modal.addEventListener('click', (e) => {
            const rect = modal.getBoundingClientRect();
            const isInModal = (
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom
            );
            if (!isInModal) {
                modal.close();
            }
        });
    }
    
    // Capture Dashboard handler
    const captureBtn = document.getElementById('capture-btn');
    if (captureBtn) {
        captureBtn.addEventListener('click', () => {
            const btnText = captureBtn.querySelector('.capture-text');
            const btnIcon = captureBtn.querySelector('.capture-icon');
            const originalText = btnText.textContent;
            const originalIcon = btnIcon.textContent;
            
            // Set loading state
            captureBtn.disabled = true;
            btnText.textContent = "Capturing...";
            btnIcon.textContent = "⚙️";
            
            // Temporarily strip gradient backgrounds from zero-size elements to prevent html2canvas failures
            const zeroElements = [];
            document.querySelectorAll('*').forEach(el => {
                const style = window.getComputedStyle(el);
                const bg = style.backgroundImage || '';
                const isGradient = bg.includes('gradient');
                const hasZeroDim = el.offsetWidth === 0 || el.offsetHeight === 0;
                
                if (isGradient && hasZeroDim) {
                    el.dataset.originalBg = el.style.backgroundImage || '';
                    el.style.setProperty('background-image', 'none', 'important');
                    zeroElements.push(el);
                }
            });
            
            const container = document.querySelector('.app-container');
            const containerHeight = container.scrollHeight || container.offsetHeight;
            
            // Run html2canvas on the main .app-container
            html2canvas(container, {
                backgroundColor: '#060609', // matching var(--bg-base)
                scale: 2, // high-res
                logging: false,
                useCORS: true,
                height: containerHeight,
                windowHeight: containerHeight,
                onclone: (clonedDoc) => {
                    // Force all animations and transitions to none to avoid intermediate state capturing
                    const style = clonedDoc.createElement('style');
                    style.textContent = `
                        * {
                            animation: none !important;
                            transition: none !important;
                            animation-name: none !important;
                            animation-delay: 0s !important;
                            animation-duration: 0s !important;
                            transition-delay: 0s !important;
                            transition-duration: 0s !important;
                        }
                        #dashboard-view {
                            opacity: 1 !important;
                            display: flex !important;
                        }
                        .card {
                            background: rgba(22, 22, 35, 0.95) !important;
                            border: 1px solid rgba(255, 255, 255, 0.12) !important;
                            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5) !important;
                        }
                        .calendar-day-item {
                            background: rgba(22, 22, 35, 0.95) !important;
                            border: 1px solid rgba(255, 255, 255, 0.08) !important;
                        }
                        .calendar-day-item.active {
                            background: rgba(167, 139, 250, 0.18) !important;
                            border: 1px solid rgba(167, 139, 250, 0.4) !important;
                        }
                        .app-header {
                            background: rgba(16, 16, 26, 0.95) !important;
                            border: 1px solid rgba(255, 255, 255, 0.1) !important;
                        }
                        .timeline-visual-wrapper {
                            background: rgba(10, 10, 18, 0.95) !important;
                            border: 1px solid rgba(255, 255, 255, 0.08) !important;
                        }
                        .logo-text {
                            background: none !important;
                            -webkit-text-fill-color: #f8fafc !important;
                            color: #f8fafc !important;
                        }
                        .active-time-value {
                            background: none !important;
                            -webkit-text-fill-color: #f8fafc !important;
                            color: #f8fafc !important;
                        }
                        /* Hide details-modal to avoid any overlay trace */
                        dialog.modal {
                            display: none !important;
                        }
                    `;
                    clonedDoc.head.appendChild(style);
                }
            }).then(canvas => {
                const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                
                // Send to backend
                return fetch('/api/save-screenshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: dataUrl })
                });
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    btnText.textContent = "Saved! ✅";
                    btnIcon.textContent = "📸";
                } else {
                    throw new Error(data.message || "Unknown error");
                }
            })
            .catch(err => {
                console.error("Error capturing dashboard:", err);
                btnText.textContent = "Error ❌";
                btnIcon.textContent = "📸";
            })
            .finally(() => {
                // Restore original background images
                zeroElements.forEach(el => {
                    if (el.dataset.originalBg) {
                        el.style.backgroundImage = el.dataset.originalBg;
                        delete el.dataset.originalBg;
                    } else {
                        el.style.removeProperty('background-image');
                    }
                });
                
                // Reset button state after 2 seconds
                setTimeout(() => {
                    captureBtn.disabled = false;
                    btnText.textContent = originalText;
                    btnIcon.textContent = originalIcon;
                }, 2000);
            });
        });
    }
    
    // Zoom and Drag Selection Timeline Event Listeners
    const timelineWrapper = document.getElementById('timeline-wrapper');
    const timelineCanvas = document.getElementById('timeline-canvas');
    const selectionOverlay = document.getElementById('selection-overlay');
    
    if (timelineWrapper && timelineCanvas && selectionOverlay) {
        const minZoom = 1.0;
        const maxZoom = 100.0;
        const zoomFactor = 1.15;
        
        // Mouse Down: Start selection drag
        timelineCanvas.addEventListener('mousedown', (e) => {
            // Left click only, ignore if hovering detail block handles click (e.g. tooltips)
            if (e.button !== 0) return;
            
            e.preventDefault(); // prevent text selection
            
            const canvasRect = timelineCanvas.getBoundingClientRect();
            startX = e.clientX - canvasRect.left;
            isDragging = true;
            
            selectionOverlay.style.left = `${startX}px`;
            selectionOverlay.style.width = '0px';
            selectionOverlay.style.display = 'block';
        });
        
        // Mouse Move: Resize selection overlay
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const canvasRect = timelineCanvas.getBoundingClientRect();
            // Bound coordinates inside canvas width
            const currentX = Math.max(0, Math.min(canvasRect.width, e.clientX - canvasRect.left));
            
            const left = Math.min(startX, currentX);
            const width = Math.abs(startX - currentX);
            
            selectionOverlay.style.left = `${left}px`;
            selectionOverlay.style.width = `${width}px`;
        });
        
        // Mouse Up: Complete selection and zoom in
        window.addEventListener('mouseup', (e) => {
            if (!isDragging) return;
            isDragging = false;
            selectionOverlay.style.display = 'none';
            
            const canvasRect = timelineCanvas.getBoundingClientRect();
            const currentX = Math.max(0, Math.min(canvasRect.width, e.clientX - canvasRect.left));
            const width = Math.abs(startX - currentX);
            const selStart = Math.min(startX, currentX);
            
            // Only trigger zoom if selection is wider than 15 pixels (ignores small clicks)
            if (width > 15) {
                const viewportWidth = timelineWrapper.clientWidth;
                const canvasWidth = timelineCanvas.clientWidth;
                
                // Calculate zoom scale factor to fit selection width exactly in viewport width
                const factor = viewportWidth / width;
                const nextZoom = Math.max(minZoom, Math.min(maxZoom, zoomLevel * factor));
                
                // Calculate selection start ratio relative to canvas width before scaling
                const ratio = selStart / canvasWidth;
                
                zoomLevel = nextZoom;
                timelineCanvas.style.width = `${zoomLevel * 100}%`;
                
                // Defer setting scrollLeft to let the browser compute the new layout boundaries first
                setTimeout(() => {
                    const newCanvasWidth = timelineCanvas.clientWidth;
                    timelineWrapper.scrollLeft = ratio * newCanvasWidth;
                }, 20);
            }
        });
        
        // Wheel Event: Zoom in/out centered on the MIDDLE of the viewport (current selection view)
        timelineWrapper.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const rect = timelineWrapper.getBoundingClientRect();
            const viewportWidth = rect.width;
            const centerOfViewportX = viewportWidth / 2;
            
            // Relative time position ratio in canvas before zoom
            const scrollLeft = timelineWrapper.scrollLeft;
            const scrollWidth = timelineWrapper.scrollWidth;
            const centerRatio = (scrollLeft + centerOfViewportX) / scrollWidth;
            
            // Adjust zoom (scroll up = zoom in, scroll down = zoom out)
            if (e.deltaY < 0) {
                zoomLevel = Math.min(maxZoom, zoomLevel * zoomFactor);
            } else {
                zoomLevel = Math.max(minZoom, zoomLevel / zoomFactor);
            }
            
            // Scale canvas
            timelineCanvas.style.width = `${zoomLevel * 100}%`;
            
            // Align scroll position to lock the midpoint focus
            const newScrollWidth = timelineWrapper.scrollWidth;
            timelineWrapper.scrollLeft = (centerRatio * newScrollWidth) - centerOfViewportX;
        }, { passive: false });
    }
});
