import { ReactNode, useMemo, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Activity, Banknote, CalendarDays, Check,
  ChevronDown, CircleHelp, CreditCard, Filter, Lightbulb, LoaderCircle,
  MoreHorizontal, Pencil, Plus, RefreshCw, Search, ShieldCheck, Sparkles,
  Trash2, Wallet, X,
} from 'lucide-react';
import {
  getGetAnalyticsQueryKey, getListCategoriesQueryKey, getListExpensesQueryKey,
  useCategorizeExpense, useCreateExpense, useDeleteExpense, useGenerateInsights,
  useGetAiStatus, useGetAnalytics, useListCategories, useListExpenses,
  useMoveExpenseCategory, useUpdateExpense,
} from '@workspace/api-client-react';
import type { Expense, ExpenseInput } from '@workspace/api-client-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type Filters = { start_date?: string; end_date?: string; category_id?: string };
type FormState = { amount: string; expense_date: string; description: string; category_id: string; payment_method: string };
const METHODS = ['UPI', 'Credit Card', 'Debit Card', 'Cash', 'Bank Transfer'];
const widgetLabels: Record<string, string> = {
  summary: 'Summary cards',
  monthly: 'Monthly spending',
  categories: 'Category split',
  transactions: 'Transactions',
  insights: 'Private insights',
  'quick-add': 'Quick capture',
};
const today = () => new Date().toISOString().slice(0, 10);
const money = (amount: unknown) => `₹${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const numberValue = (value: unknown, fallback = 0): number => typeof value === 'number' ? value : Number(value ?? fallback) || fallback;
const initialForm = (): FormState => ({ amount: '', expense_date: today(), description: '', category_id: '', payment_method: 'UPI' });
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const widgetIdFromTarget = (target: EventTarget | null): string | null => {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-widget-id]')?.dataset.widgetId ?? null;
};

function Home() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({});
  const [form, setForm] = useState<FormState>(initialForm);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [insightsText, setInsightsText] = useState('');
  const [formError, setFormError] = useState('');
  const [layoutOpen, setLayoutOpen] = useState(false);
  const defaultLayout = ['summary', 'monthly', 'categories', 'transactions', 'insights', 'quick-add'];
  const [layoutOrder, setLayoutOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('expense-ledger.layout.v1');
      const parsed = saved ? JSON.parse(saved) as { order?: string[]; hidden?: string[] } : null;
      return parsed?.order?.length ? parsed.order : defaultLayout;
    } catch { return defaultLayout; }
  });
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('expense-ledger.layout.v1');
      const parsed = saved ? JSON.parse(saved) as { hidden?: string[] } : null;
      return parsed?.hidden ?? [];
    } catch { return []; }
  });
  const [draggedExpenseId, setDraggedExpenseId] = useState<number | null>(null);
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const filterParams = useMemo(() => filters, [filters]);
  const categoriesQuery = useListCategories();
  const categories = categoriesQuery.data?.categories ?? [];
  const expensesQuery = useListExpenses(filterParams);
  const analyticsQuery = useGetAnalytics(filterParams);
  const aiQuery = useGetAiStatus();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const moveExpenseCategory = useMoveExpenseCategory();
  const categorizeExpense = useCategorizeExpense();
  const generateInsights = useGenerateInsights();
  const expenses = expensesQuery.data?.expenses ?? [];
  const analytics = record(analyticsQuery.data?.analytics);
  const kpis = record(analytics.kpis);
  const categorySource = analytics.category_breakdown;
  const monthlySource = analytics.monthly_totals;

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAnalyticsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
  };
  const toast = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2800);
  };
  const visibleExpenses = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return expenses;
    return expenses.filter((expense) =>
      `${expense.description ?? ''} ${expense.category_name} ${expense.payment_method ?? ''}`.toLowerCase().includes(term),
    );
  }, [expenses, search]);

  const beginAdd = () => {
    setEditing(null);
    setForm({ ...initialForm(), category_id: categories[0] ? String(categories[0].category_id) : '' });
    setFormError('');
    setDialogOpen(true);
  };
  const beginEdit = (expense: Expense) => {
    setEditing(expense);
    setForm({
      amount: String(expense.amount),
      expense_date: expense.expense_date,
      description: expense.description ?? '',
      category_id: String(expense.category_id),
      payment_method: expense.payment_method ?? 'UPI',
    });
    setFormError('');
    setDialogOpen(true);
  };
  const saveLayout = (order: string[], hidden: string[]) => {
    setLayoutOrder(order);
    setHiddenWidgets(hidden);
    localStorage.setItem('expense-ledger.layout.v1', JSON.stringify({ order, hidden }));
  };
  const moveWidget = (id: string, direction: -1 | 1) => {
    const from = layoutOrder.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= layoutOrder.length) return;
    const next = [...layoutOrder];
    [next[from], next[to]] = [next[to], next[from]];
    saveLayout(next, hiddenWidgets);
  };
  const moveWidgetTo = (source: string, target: string) => {
    if (source === target) return;
    const from = layoutOrder.indexOf(source);
    const to = layoutOrder.indexOf(target);
    if (from < 0 || to < 0) return;
    const next = [...layoutOrder];
    next.splice(from, 1);
    next.splice(to, 0, source);
    saveLayout(next, hiddenWidgets);
  };
  const toggleWidget = (id: string) => {
    const hidden = hiddenWidgets.includes(id) ? hiddenWidgets.filter((item) => item !== id) : [...hiddenWidgets, id];
    saveLayout(layoutOrder, hidden);
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!(amount > 0) || !Number.isFinite(amount)) {
      setFormError('Enter an amount greater than ₹0.');
      return;
    }
    if (!form.category_id) {
      setFormError('Choose a category to continue.');
      return;
    }
    const payload: ExpenseInput = {
      expense_date: form.expense_date,
      category_id: Number(form.category_id),
      amount,
      description: form.description.trim() || undefined,
      payment_method: form.payment_method || undefined,
    };
    const done = () => {
      setDialogOpen(false);
      setForm(initialForm());
      refreshData();
      toast(editing ? 'Expense updated' : 'Expense added');
    };
    if (editing) {
      updateExpense.mutate({ expenseId: editing.expense_id, data: payload }, { onSuccess: done, onError: (error) => setFormError(error.message) });
    } else {
      createExpense.mutate({ data: payload }, { onSuccess: done, onError: (error) => setFormError(error.message) });
    }
  };
  const removeExpense = (expense: Expense) => {
    if (!window.confirm(`Delete “${expense.description || expense.category_name}” from your ledger?`)) return;
    deleteExpense.mutate({ expenseId: expense.expense_id }, {
      onSuccess: () => { refreshData(); toast('Expense deleted'); },
      onError: (error) => toast(error.message),
    });
  };
  const categorize = () => {
    const description = form.description.trim();
    if (description.length < 1) {
      setFormError('Add a description before asking for a category.');
      return;
    }
    categorizeExpense.mutate({ data: { description } }, {
      onSuccess: (suggestion) => {
        setForm((current) => ({ ...current, category_id: String(suggestion.category_id) }));
        setFormError('');
        toast(`Suggested ${suggestion.category_name} · ${suggestion.source}`);
      },
      onError: (error) => setFormError(error.message),
    });
  };
  const changeCategory = (expense: Expense, categoryId: string) => {
    if (Number(categoryId) === expense.category_id) return;
    moveExpenseCategory.mutate({ expenseId: expense.expense_id, data: { category_id: Number(categoryId) } }, {
      onSuccess: () => { refreshData(); toast('Category updated'); },
      onError: (error) => toast(error.message),
    });
  };
  const requestInsights = () => {
    setInsightsText('');
    generateInsights.mutate({ params: filterParams }, {
      onSuccess: (response) => setInsightsText(response.insights),
      onError: (error) => { setInsightsText(error.message); },
    });
  };

  const breakdown = useMemo(() => {
    if (Array.isArray(categorySource)) {
      return categorySource.map((entry, index) => {
        const item = record(entry);
        return {
          name: String(item.category_name ?? item.name ?? 'Other'),
          amount: numberValue(item.amount ?? item.total ?? item.total_spent),
          color: ['#5bc99c', '#68b8ca', '#dfb86e', '#a897d9', '#dc8c79'][index % 5],
        };
      }).filter((item) => item.amount >= 0);
    }
    if (categorySource && typeof categorySource === 'object') {
      return Object.entries(categorySource as Record<string, unknown>).map(([name, value], index) => ({
        name, amount: typeof value === 'object' ? numberValue(record(value).amount ?? record(value).total) : numberValue(value),
        color: ['#5bc99c', '#68b8ca', '#dfb86e', '#a897d9', '#dc8c79'][index % 5],
      }));
    }
    const grouped = new Map<string, number>();
    expenses.forEach((expense) => grouped.set(expense.category_name, (grouped.get(expense.category_name) ?? 0) + expense.amount));
    return Array.from(grouped, ([name, amount], index) => ({ name, amount, color: ['#5bc99c', '#68b8ca', '#dfb86e', '#a897d9', '#dc8c79'][index % 5] }));
  }, [categorySource, expenses]);
  const monthly = useMemo(() => {
    if (Array.isArray(monthlySource)) {
      return monthlySource.map((entry) => {
        const item = record(entry);
        return { label: String(item.month ?? item.month_name ?? item.label ?? ''), amount: numberValue(item.amount ?? item.total ?? item.total_spent) };
      }).slice(-7);
    }
    if (monthlySource && typeof monthlySource === 'object') {
      return Object.entries(monthlySource as Record<string, unknown>).map(([label, value]) => ({
        label, amount: typeof value === 'object' ? numberValue(record(value).amount ?? record(value).total) : numberValue(value),
      })).slice(-7);
    }
    const months = new Map<string, number>();
    expenses.forEach((expense) => {
      const date = new Date(`${expense.expense_date}T12:00:00`);
      const label = date.toLocaleDateString('en-IN', { month: 'short' });
      months.set(label, (months.get(label) ?? 0) + expense.amount);
    });
    return Array.from(months, ([label, amount]) => ({ label, amount })).slice(-7);
  }, [monthlySource, expenses]);
  const totalSpend = numberValue(kpis.total_spent, expenses.reduce((sum, expense) => sum + expense.amount, 0));
  const topAmount = Math.max(...monthly.map((item) => item.amount), 1);
  const busy = createExpense.isPending || updateExpense.isPending;
  const ai = aiQuery.data;

  return (
    <main className="ledger-shell min-h-[100dvh] text-foreground">
      <div className="mx-auto max-w-[1480px] px-4 pb-12 pt-5 sm:px-7 lg:px-10">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-[14px] border border-emerald-300/20 bg-emerald-300/10 text-emerald-300"><Wallet size={21} /></div>
            <div>
              <div className="flex items-center gap-2"><h1 className="font-serif text-[23px] font-extrabold tracking-[-.04em]">Expense Ledger</h1><span className="rounded-full border border-[#303646] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[#9ca6b7]">Personal</span></div>
              <p className="mt-0.5 text-xs text-[#838c9e]">Your money, understood. Your data, always yours.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <button type="button" aria-expanded={layoutOpen} data-testid="button-layout-options" onClick={() => setLayoutOpen((open) => !open)} className="ledger-button h-10 rounded-[10px] border border-[#343949] bg-[#191d29] px-3 text-xs font-semibold text-[#c3cad5] hover:bg-[#222735]">Layout</button>
              {layoutOpen && <div data-testid="panel-layout-options" className="absolute right-0 top-12 z-40 w-[280px] rounded-xl border border-[#343949] bg-[#1b202c] p-3 shadow-2xl">
                <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#8390a3]">Dashboard layout</p><button type="button" data-testid="button-reset-layout" onClick={() => { saveLayout(defaultLayout, []); }} className="text-[10px] text-[#76d2aa] hover:text-[#a1e6c6]">Reset</button></div>
                {layoutOrder.map((widget, index) => <div key={widget} className="flex items-center gap-2 border-t border-[#2c3240] py-2">
                  <button type="button" data-testid={`button-toggle-widget-${widget}`} onClick={() => toggleWidget(widget)} className={`h-4 w-4 rounded border text-[10px] ${hiddenWidgets.includes(widget) ? 'border-[#50596a] text-transparent' : 'border-[#5bc99c] bg-[#5bc99c] text-[#10211a]'}`}>{hiddenWidgets.includes(widget) ? '' : '✓'}</button>
                  <span className={`flex-1 text-xs ${hiddenWidgets.includes(widget) ? 'text-[#697487]' : 'text-[#c4cbd6]'}`}>{widgetLabels[widget]}</span>
                  <button type="button" aria-label={`Move ${widgetLabels[widget]} up`} data-testid={`button-widget-up-${widget}`} disabled={index === 0} onClick={() => moveWidget(widget, -1)} className="rounded px-2 text-xs text-[#9ca6b6] hover:bg-white/5 disabled:opacity-30">↑</button>
                  <button type="button" aria-label={`Move ${widgetLabels[widget]} down`} data-testid={`button-widget-down-${widget}`} disabled={index === layoutOrder.length - 1} onClick={() => moveWidget(widget, 1)} className="rounded px-2 text-xs text-[#9ca6b6] hover:bg-white/5 disabled:opacity-30">↓</button>
                </div>)}
                <p className="mt-2 text-[10px] text-[#707b8e]">Visibility and order are saved on this device.</p>
              </div>}
            </div>
            <div data-testid="status-ai" className="flex items-center gap-2 rounded-full border border-[#2a3040] bg-[#191d29] px-3 py-2 text-xs text-[#aab2c1]">
              <span className={`h-1.5 w-1.5 rounded-full ${ai?.online && ai.available ? 'bg-[#5bc99c]' : 'bg-[#d3a955]'}`} />
              <span>{aiQuery.isLoading ? 'Checking local AI' : ai?.online && ai.available ? `Local AI · ${ai.model}` : 'Local rules active'}</span>
            </div>
            <button type="button" onClick={beginAdd} data-testid="button-add-expense" className="ledger-button inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#5bc99c] px-4 text-sm font-bold text-[#10211a] hover:bg-[#75d8af]">
              <Plus size={16} strokeWidth={2.5} /><span className="hidden sm:inline">Add expense</span><span className="sm:hidden">Add</span>
            </button>
          </div>
        </header>

        <div
          className="dashboard-grid"
          onDragStart={(event) => {
            const id = widgetIdFromTarget(event.target);
            if (!id) return;
            setDraggedWidgetId(id);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/dashboard-widget', id);
          }}
          onDragOver={(event) => {
            if (widgetIdFromTarget(event.target)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(event) => {
            const source = event.dataTransfer.getData('text/dashboard-widget') || draggedWidgetId;
            const target = widgetIdFromTarget(event.target);
            if (source && target && layoutOrder.includes(source)) {
              event.preventDefault();
              moveWidgetTo(source, target);
            }
            setDraggedWidgetId(null);
          }}
          onDragEnd={() => setDraggedWidgetId(null)}
        >
        {!hiddenWidgets.includes('summary') && <section draggable data-widget-id="summary" title="Drag to reorder this widget" className="grid cursor-grab gap-4 active:cursor-grabbing lg:grid-cols-[minmax(0,1fr)_300px]" style={{ order: layoutOrder.indexOf('summary') }}>
          <div className="ledger-card appear relative overflow-hidden p-5 sm:p-7">
            <div className="absolute -right-6 -top-20 h-64 w-64 rounded-full border border-emerald-300/[.07]" />
            <div className="absolute -right-1 -top-14 h-52 w-52 rounded-full border border-emerald-300/[.08]" />
            <div className="relative flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#8993a5]">Total spent <span className="normal-case tracking-normal">· current view</span></p>
                {analyticsQuery.isLoading ? <div className="skeleton mt-3 h-11 w-52 rounded-md" /> : <div data-testid="text-total-spent" className="mt-2 font-serif text-[clamp(2.2rem,5vw,3.25rem)] font-extrabold tracking-[-.06em] text-[#f1f3f6]">{money(totalSpend)}</div>}
                <div className="mt-3 flex items-center gap-2 text-xs text-[#a8b1c0]"><span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-300/10 text-emerald-300"><ShieldCheck size={12} /></span>Saved in your configured database. AI stays local when Ollama is connected.</div>
              </div>
              <div className="rounded-xl border border-[#343949] bg-[#171b27]/80 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[.12em] text-[#828c9e]">Transactions</p>
                <p data-testid="text-transaction-count" className="mt-1 font-mono text-2xl text-[#e8ebf1]">{String(kpis.total_count ?? expenses.length)}</p>
                <p className="mt-1 text-[11px] text-[#7d8799]">in selected period</p>
              </div>
            </div>
            <div className="relative mt-7 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-[#2a3040] pt-5 sm:grid-cols-4">
              <Metric label="Average" value={money(kpis.avg_transaction)} />
              <Metric label="Median" value={money(kpis.median_transaction)} />
              <Metric label="Std deviation" value={money(kpis.std_dev)} />
              <Metric label="Largest" value={money(kpis.max_transaction)} />
              <Metric label="Smallest" value={money(kpis.min_transaction)} />
              <Metric label="Top category" value={String(kpis.top_category ?? '—')} />
              <Metric label="Top category total" value={money(kpis.top_category_amount)} />
            </div>
          </div>
          <div className="ledger-card appear flex flex-col justify-between p-5" style={{ animationDelay: '70ms' }}>
            <div className="flex items-start justify-between">
              <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#8892a4]">Keep it in view</p><h2 className="mt-2 max-w-[210px] font-serif text-xl font-bold leading-tight tracking-[-.03em]">Small patterns make a big difference.</h2></div>
              <div className="rounded-xl bg-[#dfb86e]/10 p-2.5 text-[#dfb86e]"><Lightbulb size={18} /></div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[#8d97a9]">A private look at your spending, with insights generated on your own terms.</p>
            <div className="mt-4 flex items-center gap-2 text-[11px] text-[#8d97a9]"><Activity size={13} className="text-[#5bc99c]" /> {ai?.online && ai.available ? `Ready · ${ai.model}` : 'Offline-first mode available'}</div>
          </div>
        </section>}

        <section data-widget-filter className="flex flex-col justify-between gap-3 rounded-xl border border-[#292e3d] bg-[#171b27]/70 p-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-xs text-[#929bad]"><Filter size={14} /><span className="font-semibold text-[#d3d8e2]">Refine your view</span></div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <label className="relative">
              <span className="sr-only">From date</span><CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#778194]" />
              <input data-testid="input-filter-start" aria-label="From date" type="date" value={filters.start_date ?? ''} onChange={(event) => setFilters((current) => ({ ...current, start_date: event.target.value || undefined }))} className="ledger-input h-9 w-full pl-9 text-xs sm:w-[145px]" />
            </label>
            <label className="relative">
              <span className="sr-only">To date</span><CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#778194]" />
              <input data-testid="input-filter-end" aria-label="To date" type="date" value={filters.end_date ?? ''} onChange={(event) => setFilters((current) => ({ ...current, end_date: event.target.value || undefined }))} className="ledger-input h-9 w-full pl-9 text-xs sm:w-[145px]" />
            </label>
            <label className="relative col-span-2 sm:col-span-1">
              <span className="sr-only">Category filter</span>
              <select data-testid="select-filter-category" value={filters.category_id ?? ''} onChange={(event) => setFilters((current) => ({ ...current, category_id: event.target.value || undefined }))} className="ledger-input h-9 appearance-none pr-8 text-xs sm:w-[170px]">
                <option value="">All categories</option>{categories.map((category) => <option key={category.category_id} value={category.category_id}>{category.category_name}</option>)}
              </select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#778194]" />
            </label>
            {(filters.start_date || filters.end_date || filters.category_id) && <button type="button" data-testid="button-clear-filters" onClick={() => setFilters({})} className="col-span-2 rounded-lg px-3 py-2 text-xs text-[#aab2c0] hover:bg-white/5 sm:col-span-1">Clear filters</button>}
          </div>
        </section>

        <div className="contents">
          {!hiddenWidgets.includes('monthly') && <section draggable data-widget-id="monthly" title="Drag to reorder this widget" className="ledger-card appear cursor-grab p-5 active:cursor-grabbing sm:p-6" style={{ animationDelay: '120ms', order: layoutOrder.indexOf('monthly') }}>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#838d9e]">Your rhythm</p><h2 className="mt-1 font-serif text-lg font-bold tracking-[-.03em]">Spending over time</h2></div>
              <span className="rounded-full border border-[#303646] px-2.5 py-1 text-[10px] text-[#8f99aa]">Monthly · INR</span>
            </div>
            {analyticsQuery.isLoading ? <div className="skeleton h-[190px] rounded-lg" /> : analyticsQuery.data?.charts?.bar_chart ? <MatplotlibChart source={analyticsQuery.data.charts.bar_chart} label="Monthly spending chart generated by Matplotlib" /> : monthly.length ? (
              <div className="flex h-[190px] items-end gap-3 border-b border-[#303544] px-1 pb-0 pt-4">
                {monthly.map((month, index) => <div key={`${month.label}-${index}`} data-testid={`bar-month-${index}`} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="font-mono text-[10px] text-[#9da6b5] opacity-0 transition-opacity group-hover:opacity-100">{money(month.amount)}</span>
                  <div className="flex w-full flex-1 items-end"><div className="mx-auto w-full max-w-12 rounded-t-[5px] bg-gradient-to-t from-[#318a6b] to-[#6ad4a9] transition-[height] duration-500" style={{ height: `${Math.max(5, (month.amount / topAmount) * 100)}%` }} /></div>
                  <span className="pb-2 text-[10px] text-[#818b9d]">{month.label}</span>
                </div>)}
              </div>
            ) : <EmptyChart message="Add expenses to see your monthly rhythm." />}
          </section>}
          {!hiddenWidgets.includes('categories') && <section draggable data-widget-id="categories" title="Drag to reorder this widget" className="ledger-card appear cursor-grab p-5 active:cursor-grabbing sm:p-6" style={{ animationDelay: '180ms', order: layoutOrder.indexOf('categories') }}>
            <div className="mb-4 flex items-start justify-between">
              <div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#838d9e]">Where it goes</p><h2 className="mt-1 font-serif text-lg font-bold tracking-[-.03em]">Category split</h2></div>
              <MoreHorizontal size={18} className="text-[#778194]" />
            </div>
            {analyticsQuery.isLoading ? <div className="skeleton h-[190px] rounded-lg" /> : analyticsQuery.data?.charts?.pie_chart ? <MatplotlibChart source={analyticsQuery.data.charts.pie_chart} label="Category share chart generated by Matplotlib" /> : breakdown.length ? (
              <div className="space-y-4 pt-1">
                {breakdown.slice(0, 5).map((item, index) => {
                  const share = totalSpend > 0 ? Math.min(100, item.amount / totalSpend * 100) : 0;
                  return <div key={`${item.name}-${index}`} data-testid={`category-breakdown-${index}`}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 text-[#c9ced8]"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} /> <span className="truncate">{item.name}</span></span><span className="shrink-0 font-mono text-[11px] text-[#aab2c0]">{money(item.amount)}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#292e3c]"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${share}%`, backgroundColor: item.color }} /></div>
                  </div>;
                })}
              </div>
            ) : <EmptyChart message="Your category story will appear here." />}
          </section>}
        </div>

        <div className="contents">
          {!hiddenWidgets.includes('transactions') && <section draggable data-widget-id="transactions" title="Drag to reorder this widget" className="ledger-card appear min-w-0 cursor-grab overflow-hidden active:cursor-grabbing" style={{ animationDelay: '230ms', order: layoutOrder.indexOf('transactions') }}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2b3040] px-5 py-4 sm:px-6">
              <div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#838d9e]">Ledger</p><h2 className="mt-1 font-serif text-lg font-bold tracking-[-.03em]">Transactions <span className="ml-1 font-sans text-xs font-medium text-[#7c8698]">{visibleExpenses.length}</span></h2></div>
              <label className="relative w-full sm:w-56">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#778194]" /><input data-testid="input-search-expenses" type="search" aria-label="Search transactions" placeholder="Find a transaction" value={search} onChange={(event) => setSearch(event.target.value)} className="ledger-input h-9 pl-9 text-xs" />
              </label>
            </div>
            <div className="flex gap-2 overflow-x-auto border-b border-[#292e3b] px-5 py-3 sm:px-6" data-testid="category-drop-targets">
              <button type="button" data-testid="button-category-drop-all" onClick={() => setFilters((current) => ({ ...current, category_id: undefined }))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setDraggedExpenseId(null); }} className={`ledger-button shrink-0 rounded-full border px-3 py-1.5 text-[10px] ${!filters.category_id ? 'border-[#5bc99c]/50 bg-[#5bc99c]/10 text-[#7bdcb2]' : 'border-[#353b4b] text-[#929cad] hover:bg-white/5'}`}>All entries</button>
              {categories.map((category) => <button type="button" key={category.category_id} data-testid={`button-category-drop-${category.category_id}`} onClick={() => setFilters((current) => ({ ...current, category_id: String(category.category_id) }))} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { event.preventDefault(); const id = Number(event.dataTransfer.getData('text/expense-id')) || draggedExpenseId; if (id) moveExpenseCategory.mutate({ expenseId: id, data: { category_id: category.category_id } }, { onSuccess: () => { refreshData(); toast(`Moved to ${category.category_name}`); }, onError: (error) => toast(error.message) }); setDraggedExpenseId(null); }} className={`ledger-button shrink-0 rounded-full border px-3 py-1.5 text-[10px] ${filters.category_id === String(category.category_id) ? 'border-[#5bc99c]/50 bg-[#5bc99c]/10 text-[#7bdcb2]' : 'border-[#353b4b] text-[#929cad] hover:border-[#5bc99c]/50 hover:text-[#7bdcb2]'}`}>{category.category_name}<span className="ml-1 text-[9px] text-[#687386]">drop here</span></button>)}
            </div>
            {expensesQuery.isLoading ? <div className="space-y-3 p-5">{[0,1,2,3].map((row) => <div key={row} className="skeleton h-12 rounded-lg" />)}</div>
              : expensesQuery.isError ? <QueryError message={expensesQuery.error.message} retry={() => { void expensesQuery.refetch(); void analyticsQuery.refetch(); }} />
              : visibleExpenses.length ? <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead><tr className="text-[10px] uppercase tracking-[.12em] text-[#737e91]"><th className="px-5 py-3 font-semibold sm:px-6">Date</th><th className="px-3 py-3 font-semibold">Description</th><th className="px-3 py-3 font-semibold">Category</th><th className="px-3 py-3 font-semibold">Paid with</th><th className="px-3 py-3 text-right font-semibold">Amount</th><th className="px-4 py-3" /></tr></thead>
                  <tbody>{visibleExpenses.map((expense) => <tr key={expense.expense_id} draggable onDragStart={(event) => { setDraggedExpenseId(expense.expense_id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/expense-id', String(expense.expense_id)); }} onDragEnd={() => setDraggedExpenseId(null)} data-testid={`row-expense-${expense.expense_id}`} className="ledger-row cursor-grab border-t border-[#292e3b] active:cursor-grabbing">
                    <td className="whitespace-nowrap px-5 py-3.5 text-xs text-[#98a2b3] sm:px-6">{new Date(`${expense.expense_date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td className="max-w-[230px] px-3 py-3.5"><div className="truncate text-sm font-medium text-[#e1e5ed]">{expense.description || 'Untitled expense'}</div><div className="mt-0.5 text-[10px] text-[#727d90]">Ref. {String(expense.expense_id).padStart(4, '0')}</div></td>
                    <td className="px-3 py-3.5"><label className="sr-only" htmlFor={`category-${expense.expense_id}`}>Move {expense.description || 'expense'} category</label><select id={`category-${expense.expense_id}`} data-testid={`select-expense-category-${expense.expense_id}`} value={expense.category_id} onChange={(event) => changeCategory(expense, event.target.value)} className="max-w-[140px] rounded-full border border-[#343949] bg-[#1b202d] px-2.5 py-1.5 text-[11px] text-[#c8ced9] outline-none focus:border-emerald-300/60">{categories.map((category) => <option key={category.category_id} value={category.category_id}>{category.category_name}</option>)}</select></td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-xs text-[#929cad]">{expense.payment_method || '—'}</td>
                    <td data-testid={`text-expense-amount-${expense.expense_id}`} className="whitespace-nowrap px-3 py-3.5 text-right font-mono text-sm font-medium text-[#e5e9f0]">{money(expense.amount)}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right"><button type="button" aria-label={`Edit ${expense.description || 'expense'}`} data-testid={`button-edit-expense-${expense.expense_id}`} onClick={() => beginEdit(expense)} className="ledger-button rounded-md p-2 text-[#929cad] hover:bg-white/5 hover:text-white"><Pencil size={14} /></button><button type="button" aria-label={`Delete ${expense.description || 'expense'}`} data-testid={`button-delete-expense-${expense.expense_id}`} onClick={() => removeExpense(expense)} className="ledger-button rounded-md p-2 text-[#929cad] hover:bg-rose-400/10 hover:text-rose-300"><Trash2 size={14} /></button></td>
                  </tr>)}</tbody>
                </table>
              </div>
              : <div className="px-6 py-14 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-[#343949] bg-[#1b202d] text-[#99a4b5]"><Banknote size={19} /></div><h3 className="mt-4 text-sm font-semibold text-[#d6dbe5]">{search ? 'Nothing matches that search' : 'A clear ledger starts here'}</h3><p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-[#7f899b]">{search ? 'Try another merchant, category, or payment method.' : 'Add your first expense and begin seeing where your money goes.'}</p>{!search && <button type="button" onClick={beginAdd} data-testid="button-empty-add-expense" className="ledger-button mt-4 inline-flex items-center gap-2 rounded-lg border border-[#414858] px-3 py-2 text-xs font-semibold text-[#dbe2eb] hover:bg-white/5"><Plus size={14} />Add an expense</button>}</div>}
          </section>}

          <aside className="contents">
            {!hiddenWidgets.includes('insights') && <section draggable data-widget-id="insights" title="Drag to reorder this widget" className="ledger-card appear cursor-grab p-5 active:cursor-grabbing" style={{ animationDelay: '280ms', order: layoutOrder.indexOf('insights') }}>
              <div className="flex items-start justify-between gap-3">
                <div><div className="flex items-center gap-2 text-[#5bc99c]"><Sparkles size={14} /><span className="text-[10px] font-semibold uppercase tracking-[.15em]">Private intelligence</span></div><h2 className="mt-2 font-serif text-lg font-bold tracking-[-.03em]">A little perspective</h2></div>
                <div className="rounded-lg bg-[#5bc99c]/10 p-2 text-[#5bc99c]"><ShieldCheck size={16} /></div>
              </div>
                <p className="mt-2 text-xs leading-relaxed text-[#8e98aa]">Generate a brief read on the spending in your current view. Ollama handles it locally when connected; otherwise built-in rules summarize your totals.</p>
              {insightsText && <div data-testid="text-insights" className="mt-4 whitespace-pre-wrap rounded-xl border border-[#303646] bg-[#171b27] p-3 text-xs leading-relaxed text-[#c2c9d4]">{insightsText}</div>}
              <button type="button" data-testid="button-generate-insights" disabled={generateInsights.isPending} onClick={requestInsights} className="ledger-button mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#3b4b47] bg-[#1d302b] text-xs font-semibold text-[#83d9b3] hover:bg-[#244038] disabled:opacity-60">
                {generateInsights.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}{generateInsights.isPending ? 'Reading your ledger…' : 'Generate insights'}
              </button>
              <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#727d8e]"><CircleHelp size={12} /> Insights use spending aggregates, not individual transaction details.</div>
            </section>}

            {!hiddenWidgets.includes('quick-add') && <section draggable data-widget-id="quick-add" title="Drag to reorder this widget" className="ledger-card appear cursor-grab p-5 active:cursor-grabbing" style={{ animationDelay: '330ms', order: layoutOrder.indexOf('quick-add') }}>
              <div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#838d9e]">Quick capture</p><h2 className="mt-1 font-serif text-lg font-bold tracking-[-.03em]">Add an expense</h2></div><CreditCard size={18} className="text-[#8792a4]" /></div>
              <form onSubmit={onSubmit} className="mt-4 space-y-3" data-testid="form-quick-expense">
                <label className="block"><span className="mb-1.5 block text-[11px] text-[#929cad]">Amount</span><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#929cad]">₹</span><input data-testid="input-expense-amount" required min="0.01" step="0.01" type="number" placeholder="0.00" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="ledger-input pl-8 font-mono" /></div></label>
                <label className="block"><span className="mb-1.5 block text-[11px] text-[#929cad]">Description</span><div className="flex gap-2"><input data-testid="input-expense-description" maxLength={255} placeholder="What was it for?" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="ledger-input min-w-0" /><button type="button" title="Suggest category using local AI" aria-label="Suggest category" data-testid="button-ai-categorize" onClick={categorize} disabled={categorizeExpense.isPending} className="ledger-button grid h-[42px] w-[42px] shrink-0 place-items-center rounded-lg border border-[#343949] bg-[#1b202d] text-[#73d3a9] hover:bg-[#22352f] disabled:opacity-50">{categorizeExpense.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}</button></div></label>
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="mb-1.5 block text-[11px] text-[#929cad]">Date</span><input data-testid="input-expense-date" required type="date" value={form.expense_date} onChange={(event) => setForm({ ...form, expense_date: event.target.value })} className="ledger-input px-2 text-xs" /></label>
                  <label><span className="mb-1.5 block text-[11px] text-[#929cad]">Payment</span><select data-testid="select-expense-payment" value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })} className="ledger-input px-2 text-xs">{METHODS.map((method) => <option key={method}>{method}</option>)}</select></label>
                </div>
                <label className="block"><span className="mb-1.5 block text-[11px] text-[#929cad]">Category</span><select data-testid="select-expense-category" required value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })} className="ledger-input text-xs">{categories.length ? categories.map((category) => <option key={category.category_id} value={category.category_id}>{category.category_name}</option>) : <option value="">Loading categories…</option>}</select></label>
                {formError && !dialogOpen && <p data-testid="text-form-error" className="text-xs text-rose-300">{formError}</p>}
                <button type="submit" data-testid="button-submit-expense" disabled={busy || categories.length === 0} className="ledger-button flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#5bc99c] text-xs font-bold text-[#10211a] hover:bg-[#75d8af] disabled:opacity-50">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}{busy ? 'Saving…' : 'Add to ledger'}</button>
              </form>
            </section>}
          </aside>
        </div>
        </div>
        <footer className="mt-7 flex flex-wrap items-center justify-between gap-2 border-t border-[#282d3b] pt-4 text-[10px] text-[#667184]"><span>Expense Ledger <span className="px-1.5">/</span> Private by design</span><span className="flex items-center gap-1.5"><ShieldCheck size={12} />Transactions stay yours</span></footer>
      </div>

      {dialogOpen && <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }} className="fixed inset-0 z-50 flex items-center justify-center bg-[#080a10]/75 p-4 backdrop-blur-sm">
        <section role="dialog" aria-modal="true" aria-labelledby="expense-dialog-title" className="ledger-card w-full max-w-md p-5 shadow-2xl sm:p-6">
          <div className="mb-5 flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#838d9e]">{editing ? 'Edit transaction' : 'New transaction'}</p><h2 id="expense-dialog-title" className="mt-1 font-serif text-xl font-bold">{editing ? 'Refine this expense' : 'Add an expense'}</h2></div><button type="button" data-testid="button-close-expense-dialog" onClick={() => setDialogOpen(false)} className="rounded-lg p-2 text-[#8b95a6] hover:bg-white/5"><X size={17} /></button></div>
          <form onSubmit={onSubmit} className="space-y-3" data-testid="form-expense-dialog">
            <label className="block text-xs text-[#929cad]">Amount<input required min="0.01" step="0.01" data-testid="input-dialog-amount" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="ledger-input mt-1.5 font-mono" /></label>
            <label className="block text-xs text-[#929cad]">Description<input maxLength={255} data-testid="input-dialog-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="ledger-input mt-1.5" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[#929cad]">Date<input required type="date" data-testid="input-dialog-date" value={form.expense_date} onChange={(event) => setForm({ ...form, expense_date: event.target.value })} className="ledger-input mt-1.5 px-2 text-xs" /></label>
              <label className="block text-xs text-[#929cad]">Payment<select data-testid="select-dialog-payment" value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })} className="ledger-input mt-1.5 px-2 text-xs">{METHODS.map((method) => <option key={method}>{method}</option>)}</select></label>
            </div>
            <label className="block text-xs text-[#929cad]">Category<select required data-testid="select-dialog-category" value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })} className="ledger-input mt-1.5 text-xs">{categories.map((category) => <option key={category.category_id} value={category.category_id}>{category.category_name}</option>)}</select></label>
            {formError && <p data-testid="text-dialog-error" className="text-xs text-rose-300">{formError}</p>}
            <div className="flex justify-end gap-2 pt-2"><button type="button" data-testid="button-cancel-expense" onClick={() => setDialogOpen(false)} className="ledger-button rounded-lg border border-[#353b4b] px-4 py-2.5 text-xs font-semibold text-[#b4bdca] hover:bg-white/5">Cancel</button><button type="submit" data-testid="button-save-expense" disabled={busy} className="ledger-button inline-flex items-center gap-2 rounded-lg bg-[#5bc99c] px-4 py-2.5 text-xs font-bold text-[#10211a] hover:bg-[#75d8af] disabled:opacity-50">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{editing ? 'Save changes' : 'Add expense'}</button></div>
          </form>
        </section>
      </div>}
      {notice && <div role="status" data-testid="status-toast" className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-xl border border-[#3a4351] bg-[#202633] px-4 py-3 text-xs font-medium text-[#e2e7ee] shadow-xl"><Check size={15} className="text-[#5bc99c]" />{notice}</div>}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] uppercase tracking-[.12em] text-[#808b9d]">{label}</p><p data-testid={`text-metric-${label.toLowerCase().replace(/\s+/g, '-')}`} className="mt-1 truncate text-sm font-semibold text-[#dce1e9]">{value}</p></div>;
}

function MatplotlibChart({ source, label }: { source: string; label: string }) {
  const src = source.startsWith('data:') || source.startsWith('http') || source.startsWith('/') ? source : `data:image/png;base64,${source}`;
  return <div className="grid min-h-[190px] place-items-center overflow-hidden rounded-lg border border-[#2d3342] bg-[#151923] p-2">
    <img src={src} alt={label} data-testid={`img-${label.includes('Monthly') ? 'monthly' : 'category'}-chart`} className="max-h-[230px] max-w-full object-contain" />
  </div>;
}

function EmptyChart({ message }: { message: string }) {
  return <div className="grid h-[190px] place-items-center rounded-lg border border-dashed border-[#343949] text-center"><div><div className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-[#202532] text-[#8d98aa]"><Activity size={16} /></div><p className="mt-2 text-xs text-[#8791a3]">{message}</p></div></div>;
}

function QueryError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="px-6 py-14 text-center"><p className="text-sm font-semibold text-[#e2e6ed]">Couldn’t load your ledger</p><p data-testid="text-expenses-error" className="mx-auto mt-1 max-w-sm text-xs text-[#8993a5]">{message}</p><button type="button" data-testid="button-retry-expenses" onClick={retry} className="ledger-button mt-4 inline-flex items-center gap-2 rounded-lg border border-[#414858] px-3 py-2 text-xs font-semibold text-[#dbe2eb] hover:bg-white/5"><RefreshCw size={13} />Try again</button></div>;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
