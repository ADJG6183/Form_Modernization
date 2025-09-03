/**
 * PDF Error Reporter - Standalone utility for reporting PDF loading errors
 */

// Create global namespace for PDF error reporting
window.pdfErrorReporter = window.pdfErrorReporter || {};

/**
 * Report PDF loading errors to server for debugging
 */
window.pdfErrorReporter.reportPDFError = function(error, portfolioId, pdfUrl, details = {}) {
    // Create error report
    const errorReport = {
        timestamp: new Date().toISOString(),
        error: error.message || String(error),
        stack: error.stack || 'No stack trace',
        portfolioId: portfolioId,
        pdfUrl: pdfUrl,
        browser: navigator.userAgent,
        referrer: document.referrer,
        currentPath: window.location.pathname,
        ...details
    };
    
    // Show debug modal if available
    if (typeof window.showDebugModal === 'function') {
        window.showDebugModal(errorReport);
    }
    
    // Log to console
    console.error('PDF Error Report:', errorReport);
    
    // Send to server for logging
    fetch('/api/log-error', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            error_type: 'pdf_loading_error',
            error_data: errorReport
        })
    }).catch(e => {
        console.error('Failed to report error to server:', e);
    });
    
    return errorReport;
}

/**
 * Show a notification to the user - standalone implementation
 */
window.pdfErrorReporter.showNotification = function(message, type = 'info', duration = 5000, onClick = null) {
    // Use global showNotification function if available
    if (typeof window.showNotification === 'function') {
        return window.showNotification(message, type, duration, onClick);
    }
    
    // Fallback implementation
    const container = document.getElementById('notification-container');
    if (!container) {
        console.error(message);
        return;
    }
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button class="notification-close">&times;</button>
    `;
    
    container.appendChild(notification);
    
    // Add animation
    setTimeout(() => notification.classList.add('active'), 10);
    
    // Remove after duration
    const timeout = setTimeout(() => {
        notification.classList.remove('active');
        setTimeout(() => notification.remove(), 300);
    }, duration);
    
    // Add close button handler
    const closeBtn = notification.querySelector('.notification-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(timeout);
            notification.classList.remove('active');
            setTimeout(() => notification.remove(), 300);
        });
    }
    
    return notification;
}
