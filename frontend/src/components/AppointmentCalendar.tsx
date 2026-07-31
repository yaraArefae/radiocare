"use client";

import { useMemo } from "react";

export type CalendarAppointment = {
  id: string;
  scheduledAt: string;
  status: string;
  title: string;
};

type Props = {
  appointments: CalendarAppointment[];
  visibleMonth: Date;
  selectedDate: Date | null;
  onVisibleMonthChange: (month: Date) => void;
  onSelectDate: (date: Date) => void;
  isLoading?: boolean;
};

const weekDayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const appointmentStatusStyle: Record<
  string,
  { chip: string; dot: string; label: string }
> = {
  Pending: {
    chip: "border-amber-300/35 bg-amber-400/15 text-amber-100",
    dot: "bg-amber-300",
    label: "Waiting for patient approval",
  },
  Confirmed: {
    chip: "border-emerald-300/35 bg-emerald-400/15 text-emerald-100",
    dot: "bg-emerald-300",
    label: "Approved by the patient",
  },
  Declined: {
    chip: "border-rose-300/35 bg-rose-400/15 text-rose-100",
    dot: "bg-rose-300",
    label: "Declined by the patient",
  },
  Cancelled: {
    chip: "border-slate-300/25 bg-slate-400/10 text-slate-300",
    dot: "bg-slate-400",
    label: "Cancelled by the doctor",
  },
  Completed: {
    chip: "border-cyan-300/35 bg-cyan-400/15 text-cyan-100",
    dot: "bg-cyan-300",
    label: "Visit completed",
  },
};

export function getStatusStyle(status: string) {
  return (
    appointmentStatusStyle[status] ?? {
      chip: "border-white/20 bg-white/10 text-slate-200",
      dot: "bg-slate-300",
      label: status || "Unknown",
    }
  );
}

export function toDayKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/*
  The visible grid always starts on the Sunday before the first day of
  the month and covers six full weeks, so the layout never jumps.
*/
export function getCalendarGridRange(month: Date) {
  const firstDayOfMonth = new Date(
    month.getFullYear(),
    month.getMonth(),
    1,
  );

  const gridStart = new Date(firstDayOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 42);

  return { gridStart, gridEnd };
}

export default function AppointmentCalendar({
  appointments,
  visibleMonth,
  selectedDate,
  onVisibleMonthChange,
  onSelectDate,
  isLoading = false,
}: Props) {
  const appointmentsByDay = useMemo(() => {
    const groups = new Map<string, CalendarAppointment[]>();

    for (const appointment of appointments) {
      const dayKey = toDayKey(appointment.scheduledAt);

      if (!dayKey) continue;

      const dayAppointments = groups.get(dayKey) ?? [];
      dayAppointments.push(appointment);
      groups.set(dayKey, dayAppointments);
    }

    for (const dayAppointments of groups.values()) {
      dayAppointments.sort(
        (first, second) =>
          new Date(first.scheduledAt).getTime() -
          new Date(second.scheduledAt).getTime(),
      );
    }

    return groups;
  }, [appointments]);

  const days = useMemo(() => {
    const { gridStart } = getCalendarGridRange(visibleMonth);

    return Array.from({ length: 42 }, (unused, index) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      return day;
    });
  }, [visibleMonth]);

  const todayKey = toDayKey(new Date());
  const selectedKey = selectedDate ? toDayKey(selectedDate) : "";

  function shiftMonth(offset: number) {
    onVisibleMonthChange(
      new Date(
        visibleMonth.getFullYear(),
        visibleMonth.getMonth() + offset,
        1,
      ),
    );
  }

  return (
    <section className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur-2xl md:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
            Appointments Calendar
          </p>

          <h2 className="mt-2 text-2xl font-black text-white">
            {visibleMonth.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 transition hover:border-cyan-300/50 hover:text-white"
          >
            ← Previous
          </button>

          <button
            type="button"
            onClick={() => {
              const today = new Date();
              onVisibleMonthChange(
                new Date(today.getFullYear(), today.getMonth(), 1),
              );
              onSelectDate(today);
            }}
            className="rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2.5 font-bold text-cyan-100 transition hover:bg-cyan-400/25"
          >
            Today
          </button>

          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 transition hover:border-cyan-300/50 hover:text-white"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-1.5 text-center sm:gap-2">
        {weekDayNames.map((weekDayName) => (
          <div
            key={weekDayName}
            className="py-2 text-xs font-black uppercase tracking-wider text-slate-400"
          >
            {weekDayName}
          </div>
        ))}

        {days.map((day) => {
          const dayKey = toDayKey(day);
          const dayAppointments = appointmentsByDay.get(dayKey) ?? [];
          const isCurrentMonth =
            day.getMonth() === visibleMonth.getMonth();
          const isToday = dayKey === todayKey;
          const isSelected = dayKey === selectedKey;

          return (
            <button
              key={dayKey}
              type="button"
              onClick={() => onSelectDate(day)}
              className={[
                "flex min-h-24 flex-col gap-1 rounded-2xl border p-2 text-left transition sm:min-h-28",
                isSelected
                  ? "border-cyan-300/70 bg-cyan-400/15"
                  : "border-white/10 bg-white/[0.04] hover:border-cyan-300/35 hover:bg-white/[0.08]",
                isCurrentMonth ? "opacity-100" : "opacity-40",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-sm font-black",
                  isToday
                    ? "bg-gradient-to-r from-blue-600 to-cyan-400 text-white"
                    : "text-slate-200",
                ].join(" ")}
              >
                {day.getDate()}
              </span>

              <div className="flex flex-col gap-1">
                {dayAppointments.slice(0, 2).map((appointment) => {
                  const style = getStatusStyle(appointment.status);

                  return (
                    <span
                      key={appointment.id}
                      className={`truncate rounded-lg border px-1.5 py-1 text-[11px] font-bold ${style.chip}`}
                    >
                      {formatTime(appointment.scheduledAt)} ·{" "}
                      {appointment.title}
                    </span>
                  );
                })}

                {dayAppointments.length > 2 && (
                  <span className="px-1 text-[11px] font-bold text-cyan-200">
                    +{dayAppointments.length - 2} more
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {Object.entries(appointmentStatusStyle).map(([status, style]) => (
          <span
            key={status}
            className="flex items-center gap-2 text-xs font-bold text-slate-300"
          >
            <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
            {status}
          </span>
        ))}

        {isLoading && (
          <span className="text-xs font-bold text-cyan-200">
            Refreshing...
          </span>
        )}
      </div>
    </section>
  );
}
