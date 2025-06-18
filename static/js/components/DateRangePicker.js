import React from 'react';

/**
 * DateRangePicker component for selecting start and end dates for backtesting
 */
function DateRangePicker({ startDate, endDate, onChange }) {
  // Format date for input value (YYYY-MM-DD)
  const formatDateForInput = (date) => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  };

  // Handle date change events
  const handleDateChange = (field, e) => {
    const date = new Date(e.target.value);

    if (isNaN(date)) return; // Invalid date

    if (field === 'start') {
      onChange({
        startDate: date,
        endDate: endDate
      });
    } else {
      onChange({
        startDate: startDate,
        endDate: date
      });
    }
  };

  // Validate the dates (end date must be after start date)
  const validateDates = () => {
    if (!startDate || !endDate) return '';

    if (endDate < startDate) {
      return 'End date must be after start date';
    }

    const diffTime = Math.abs(endDate - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 365 * 3) {
      return 'Warning: Long date ranges may cause performance issues';
    }

    return '';
  };

  const errorMessage = validateDates();

  return (
    <div className="date-range-picker">
      <div className="date-inputs">
        <label className="form-label">
          Start Date:
          <input
            type="date"
            className="form-input"
            value={formatDateForInput(startDate)}
            onChange={(e) => handleDateChange('start', e)}
            max={formatDateForInput(new Date())} // Can't select future dates
          />
        </label>

        <label className="form-label">
          End Date:
          <input
            type="date"
            className="form-input"
            value={formatDateForInput(endDate)}
            onChange={(e) => handleDateChange('end', e)}
            max={formatDateForInput(new Date())} // Can't select future dates
          />
        </label>
      </div>

      {errorMessage && (
        <div className="date-error">
          {errorMessage}
        </div>
      )}

      <div className="date-preset-buttons">
        <button
          type="button"
          onClick={() => {
            const end = new Date();
            const start = new Date();
            start.setMonth(start.getMonth() - 1);
            onChange({ startDate: start, endDate: end });
          }}
          className="date-preset-btn"
        >
          Last Month
        </button>

        <button
          type="button"
          onClick={() => {
            const end = new Date();
            const start = new Date();
            start.setMonth(start.getMonth() - 3);
            onChange({ startDate: start, endDate: end });
          }}
          className="date-preset-btn"
        >
          Last 3 Months
        </button>

        <button
          type="button"
          onClick={() => {
            const end = new Date();
            const start = new Date();
            start.setMonth(start.getMonth() - 6);
            onChange({ startDate: start, endDate: end });
          }}
          className="date-preset-btn"
        >
          Last 6 Months
        </button>

        <button
          type="button"
          onClick={() => {
            const end = new Date();
            const start = new Date();
            start.setFullYear(start.getFullYear() - 1);
            onChange({ startDate: start, endDate: end });
          }}
          className="date-preset-btn"
        >
          Last Year
        </button>
      </div>
    </div>
  );
}

export default DateRangePicker;
