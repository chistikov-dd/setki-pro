import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ============================================================
// Типы данных
// ============================================================

interface ReportMatch {
  match_id: number;
  bracket_id: number;
  round_number: number;
  match_number: number;
  p1_id: number | null;
  p1_name: string | null;
  p1_club: string | null;
  p2_id: number | null;
  p2_name: string | null;
  p2_club: string | null;
  score_p1: number;
  score_p2: number;
  warnings_p1: number;
  warnings_p2: number;
  winner_id: number | null;
  result_type: string | null;
  status: string;
}

interface ReportBracket {
  bracket_id: number;
  category_name: string | null;
  weight_min: number | null;
  weight_max: number | null;
  gender: string | null;
  sport_name: string | null;
  bracket_type: string | null;
  total_rounds: number | null;
  status: string;
}

interface ReportPlace {
  bracket_id: number;
  bracket_name: string | null;
  place: number;
  fighter_id: number | null;
  fighter_name: string;
  club_name: string | null;
}

interface TournamentInfo {
  name?: string;
  location?: string;
  city?: string;
  start_date?: string;
  end_date?: string;
}

export interface ReportData {
  tournament: TournamentInfo | null;
  tournament_name_cached: string | null;
  brackets: ReportBracket[];
  matches: ReportMatch[];
  places: ReportPlace[];
}

// ============================================================
// Вспомогательные функции
// ============================================================

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = formatDate(start);
  const e = formatDate(end);
  if (s && e && s !== e) return `${s} – ${e}`;
  if (s) return s;
  return '';
}

function genderLabel(gender: string | null | undefined): string {
  if (!gender) return '';
  const g = gender.toLowerCase();
  if (g === 'male' || g === 'm' || g === 'муж') return 'Мужчины';
  if (g === 'female' || g === 'f' || g === 'жен') return 'Женщины';
  return gender;
}

function weightLabel(min: number | null, max: number | null): string {
  if (min && max) return `${min}–${max} кг`;
  if (max) return `до ${max} кг`;
  if (min) return `от ${min} кг`;
  return '';
}

function placeLabel(place: number): string {
  if (place === 1) return '1 место';
  if (place === 2) return '2 место';
  if (place === 3) return '3 место';
  return `${place} место`;
}

function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round + 1;
  if (fromEnd === 1) return 'Финал';
  if (fromEnd === 2) return '1/2 финала';
  if (fromEnd === 3) return '1/4 финала';
  if (fromEnd === 4) return '1/8 финала';
  if (fromEnd === 5) return '1/16 финала';
  return `Раунд ${round}`;
}

function scoreLabel(m: ReportMatch): string {
  if (m.status !== 'completed' && m.status !== 'finished') return '';
  const w1 = m.warnings_p1 ? ` (пр: ${m.warnings_p1})` : '';
  const w2 = m.warnings_p2 ? ` (пр: ${m.warnings_p2})` : '';
  const rt = m.result_type ? ` ${m.result_type.toUpperCase()}` : '';
  return `${m.score_p1}:${m.score_p2}${w1}${w2}${rt}`;
}

// ============================================================
// Настройки PDF: кириллица через UTF-8 (base85 встроенный шрифт)
// jsPDF поддерживает UTF-8 при использовании стандартных шрифтов
// ============================================================

function createDoc(): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  // Используем стандартный шрифт helvetica с поддержкой Unicode через jsPDF
  doc.setFont('helvetica');
  return doc;
}

const PAGE_W = 210;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;

function addPageHeader(doc: jsPDF, info: TournamentInfo | null, nameCached: string | null, y: number): number {
  const name = info?.name || nameCached || 'Турнир';
  const location = [info?.location, info?.city].filter(Boolean).join(', ');
  const dates = formatDateRange(info?.start_date, info?.end_date);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(name, PAGE_W / 2, y, { align: 'center' });
  y += 5;
  if (dates || location) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const sub = [dates, location].filter(Boolean).join(' | ');
    doc.text(sub, PAGE_W / 2, y, { align: 'center' });
    y += 5;
  }
  doc.setDrawColor(150);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 4;
  return y;
}

function addSectionTitle(doc: jsPDF, title: string, y: number): number {
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(title, MARGIN, y);
  y += 6;
  return y;
}

// ============================================================
// ТИТУЛЬНАЯ СТРАНИЦА
// ============================================================

function addTitlePage(doc: jsPDF, data: ReportData): void {
  const info = data.tournament;
  const name = info?.name || data.tournament_name_cached || 'Турнир';
  const location = [info?.location, info?.city].filter(Boolean).join(', ');
  const dates = formatDateRange(info?.start_date, info?.end_date);

  let y = 60;
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');

  // Перенос длинного названия
  const lines = doc.splitTextToSize(name.toUpperCase(), CONTENT_W) as string[];
  lines.forEach((line: string) => {
    doc.text(line, PAGE_W / 2, y, { align: 'center' });
    y += 10;
  });

  y += 10;
  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  if (dates) {
    doc.text(dates, PAGE_W / 2, y, { align: 'center' });
    y += 8;
  }
  if (location) {
    doc.text(location, PAGE_W / 2, y, { align: 'center' });
    y += 8;
  }

  y += 20;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('ИТОГОВЫЙ ПРОТОКОЛ', PAGE_W / 2, y, { align: 'center' });

  y += 30;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  const now = new Date().toLocaleDateString('ru-RU');
  doc.text(`Сформировано: ${now}`, PAGE_W / 2, y, { align: 'center' });
  doc.setTextColor(0);

  // Статистика внизу страницы
  y = 250;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Категорий: ${data.brackets.length}`, MARGIN, y);
  y += 5;

  const uniqueAthletes = new Set<string>();
  data.matches.forEach(m => {
    if (m.p1_name) uniqueAthletes.add(m.p1_name);
    if (m.p2_name) uniqueAthletes.add(m.p2_name);
  });
  doc.text(`Участников: ~${uniqueAthletes.size}`, MARGIN, y);
  y += 5;

  const completedMatches = data.matches.filter(m => m.status === 'completed' || m.status === 'finished').length;
  doc.text(`Поединков проведено: ${completedMatches} из ${data.matches.length}`, MARGIN, y);
}

// ============================================================
// РАСПРЕДЕЛЕНИЕ МЕСТ ПО КАТЕГОРИЯМ
// ============================================================

function addPlacesSection(doc: jsPDF, data: ReportData): void {
  if (data.places.length === 0 && data.matches.length === 0) return;

  doc.addPage();
  const info = data.tournament;

  let y = MARGIN;
  y = addPageHeader(doc, info, data.tournament_name_cached, y);
  y = addSectionTitle(doc, 'Распределение мест', y);

  // Группируем места по категориям
  const byBracket = new Map<number, ReportPlace[]>();
  data.places.forEach(p => {
    if (!byBracket.has(p.bracket_id)) byBracket.set(p.bracket_id, []);
    byBracket.get(p.bracket_id)!.push(p);
  });

  // Для категорий без мест — вычисляем из матчей
  const bracketsWithPlaces = new Set(data.places.map(p => p.bracket_id));
  data.brackets.forEach(b => {
    if (!bracketsWithPlaces.has(b.bracket_id)) {
      const computed = computePlacesFromMatches(b.bracket_id, data.matches);
      if (computed.length > 0) byBracket.set(b.bracket_id, computed);
    }
  });

  byBracket.forEach((places, bracketId) => {
    const bracket = data.brackets.find(b => b.bracket_id === bracketId);
    const catName = places[0]?.bracket_name || bracket?.category_name || `Категория ${bracketId}`;
    const weightStr = bracket ? weightLabel(bracket.weight_min, bracket.weight_max) : '';
    const genderStr = bracket ? genderLabel(bracket.gender) : '';

    const title = [genderStr, weightStr, catName].filter(Boolean).join(' · ');

    // Проверяем, поместится ли таблица
    if (y > 240) {
      doc.addPage();
      y = MARGIN;
      y = addPageHeader(doc, info, data.tournament_name_cached, y);
    }

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(title, MARGIN, y);
    y += 4;

    const tableData = places
      .sort((a, b) => a.place - b.place)
      .map(p => [
        placeLabel(p.place),
        p.fighter_name,
        p.club_name || '—',
      ]);

    autoTable(doc, {
      startY: y,
      head: [['Место', 'Участник', 'Клуб/команда']],
      body: tableData,
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [60, 80, 120], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 75 },
        2: { cellWidth: CONTENT_W - 100 },
      },
      theme: 'striped',
    });

    y = (doc as any).lastAutoTable.finalY + 6;
  });
}

// ============================================================
// ТУРНИРНЫЕ СЕТКИ (SINGLE ELIMINATION)
// ============================================================

function addBracketsSection(doc: jsPDF, data: ReportData): void {
  const seBrackets = data.brackets.filter(b =>
    b.bracket_type === 'single_elimination' || b.bracket_type === 'single-elimination' || !b.bracket_type
  );

  seBrackets.forEach(bracket => {
    const bracketMatches = data.matches
      .filter(m => m.bracket_id === bracket.bracket_id)
      .sort((a, b) => a.round_number - b.round_number || a.match_number - b.match_number);

    if (bracketMatches.length === 0) return;

    doc.addPage();
    const info = data.tournament;
    let y = MARGIN;
    y = addPageHeader(doc, info, data.tournament_name_cached, y);

    const catName = bracket.category_name || `Категория ${bracket.bracket_id}`;
    const weightStr = weightLabel(bracket.weight_min, bracket.weight_max);
    const genderStr = genderLabel(bracket.gender);
    const title = [genderStr, weightStr, catName].filter(Boolean).join(' · ');
    y = addSectionTitle(doc, `Сетка: ${title}`, y);

    const totalRounds = bracket.total_rounds || Math.max(...bracketMatches.map(m => m.round_number));
    const rounds = new Map<number, ReportMatch[]>();
    bracketMatches.forEach(m => {
      if (!rounds.has(m.round_number)) rounds.set(m.round_number, []);
      rounds.get(m.round_number)!.push(m);
    });

    // Заголовки раундов
    const headers = Array.from({ length: totalRounds }, (_, i) => roundLabel(i + 1, totalRounds));

    const tableData: string[][] = [];

    // Строки: для каждого матча первого раунда — 3 строки (участник1, счёт, участник2)
    const firstRound = rounds.get(1) || [];
    firstRound.forEach((match) => {
      const row1: string[] = [];
      const row2: string[] = [];
      const row3: string[] = [];

      for (let r = 1; r <= totalRounds; r++) {
        const roundMatches = rounds.get(r) || [];
        // Находим матч в раунде, соответствующий данному матчу первого раунда
        const idx = Math.floor((match.match_number - 1) / Math.pow(2, r - 1));
        const rm = roundMatches.find(m => m.match_number === idx + 1);

        row1.push(rm ? (rm.p1_name || 'TBD') : '');
        row2.push(rm ? scoreLabel(rm) : '');
        row3.push(rm ? (rm.p2_name || 'TBD') : '');
      }

      tableData.push(row1);
      tableData.push(row2);
      tableData.push(row3);
    });

    autoTable(doc, {
      startY: y,
      head: [headers],
      body: tableData,
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 7, cellPadding: 1 },
      headStyles: { fillColor: [40, 60, 100], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      columnStyles: Object.fromEntries(
        headers.map((_, i) => [i, { cellWidth: CONTENT_W / totalRounds }])
      ),
      theme: 'grid',
      didParseCell: (hookData: any) => {
        const row = hookData.row.index;
        // Строки счёта (каждая 2-я из трёх) — серый фон
        if (row % 3 === 1) {
          hookData.cell.styles.fillColor = [240, 240, 240];
          hookData.cell.styles.textColor = [80, 80, 80];
          hookData.cell.styles.fontSize = 6;
        }
      },
    });

    // Победитель
    const finalMatch = bracketMatches.find(m => m.round_number === totalRounds);
    if (finalMatch?.winner_id) {
      const winnerName = finalMatch.winner_id === finalMatch.p1_id
        ? finalMatch.p1_name
        : finalMatch.p2_name;
      const winnerClub = finalMatch.winner_id === finalMatch.p1_id
        ? finalMatch.p1_club
        : finalMatch.p2_club;

      const fy = (doc as any).lastAutoTable.finalY + 5;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`Победитель: ${winnerName || '—'}${winnerClub ? ` (${winnerClub})` : ''}`, MARGIN, fy);
    }
  });
}

// ============================================================
// ПОЛНАЯ ТАБЛИЦА РЕЗУЛЬТАТОВ ПО КАТЕГОРИЯМ
// ============================================================

function addResultsSection(doc: jsPDF, data: ReportData): void {
  if (data.matches.length === 0) return;

  doc.addPage();
  const info = data.tournament;
  let y = MARGIN;
  y = addPageHeader(doc, info, data.tournament_name_cached, y);
  y = addSectionTitle(doc, 'Сводная таблица поединков', y);

  // Группируем матчи по сеткам
  data.brackets.forEach(bracket => {
    const bracketMatches = data.matches
      .filter(m => m.bracket_id === bracket.bracket_id && (m.status === 'completed' || m.status === 'finished'))
      .sort((a, b) => a.round_number - b.round_number || a.match_number - b.match_number);

    if (bracketMatches.length === 0) return;

    const catName = bracket.category_name || `Категория ${bracket.bracket_id}`;
    const weightStr = weightLabel(bracket.weight_min, bracket.weight_max);
    const genderStr = genderLabel(bracket.gender);
    const title = [genderStr, weightStr, catName].filter(Boolean).join(' · ');

    const totalRounds = bracket.total_rounds || Math.max(...bracketMatches.map(m => m.round_number));

    if (y > 230) {
      doc.addPage();
      y = MARGIN;
      y = addPageHeader(doc, info, data.tournament_name_cached, y);
    }

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(title, MARGIN, y);
    y += 4;

    const tableData = bracketMatches.map(m => [
      roundLabel(m.round_number, totalRounds),
      m.p1_name || '—',
      m.p1_club || '—',
      `${m.score_p1}:${m.score_p2}`,
      m.p2_name || '—',
      m.p2_club || '—',
      m.winner_id === m.p1_id ? m.p1_name || '—' : m.p2_name || '—',
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Раунд', 'Участник 1', 'Клуб', 'Счёт', 'Участник 2', 'Клуб', 'Победитель']],
      body: tableData,
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 7, cellPadding: 1.2, overflow: 'linebreak' },
      headStyles: { fillColor: [60, 80, 120], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 35 },
        2: { cellWidth: 28 },
        3: { cellWidth: 14 },
        4: { cellWidth: 35 },
        5: { cellWidth: 28 },
        6: { cellWidth: CONTENT_W - 162 },
      },
      theme: 'striped',
    });

    y = (doc as any).lastAutoTable.finalY + 6;
  });
}

// ============================================================
// Вычисление мест из матчей (когда tournament_places пуста)
// ============================================================

function computePlacesFromMatches(bracketId: number, matches: ReportMatch[]): ReportPlace[] {
  const bracketMatches = matches.filter(m => m.bracket_id === bracketId);
  if (bracketMatches.length === 0) return [];

  const totalRounds = Math.max(...bracketMatches.map(m => m.round_number));
  const result: ReportPlace[] = [];

  // Финал
  const final = bracketMatches.find(m => m.round_number === totalRounds);
  if (final?.winner_id) {
    const winnerId = final.winner_id;
    const loserId = winnerId === final.p1_id ? final.p2_id : final.p1_id;
    const winnerName = winnerId === final.p1_id ? final.p1_name : final.p2_name;
    const winnerClub = winnerId === final.p1_id ? final.p1_club : final.p2_club;
    const loserName = loserId === final.p1_id ? final.p1_name : final.p2_name;
    const loserClub = loserId === final.p1_id ? final.p1_club : final.p2_club;

    if (winnerName) result.push({ bracket_id: bracketId, bracket_name: null, place: 1, fighter_id: winnerId, fighter_name: winnerName, club_name: winnerClub || null });
    if (loserName) result.push({ bracket_id: bracketId, bracket_name: null, place: 2, fighter_id: loserId, fighter_name: loserName, club_name: loserClub || null });
  }

  // Полуфинал → 3-4 места
  if (totalRounds >= 2) {
    const semis = bracketMatches.filter(m => m.round_number === totalRounds - 1);
    let place = 3;
    semis.forEach(m => {
      if (m.winner_id) {
        const loserId = m.winner_id === m.p1_id ? m.p2_id : m.p1_id;
        const loserName = loserId === m.p1_id ? m.p1_name : m.p2_name;
        const loserClub = loserId === m.p1_id ? m.p1_club : m.p2_club;
        if (loserName) result.push({ bracket_id: bracketId, bracket_name: null, place, fighter_id: loserId, fighter_name: loserName, club_name: loserClub || null });
        place++;
      }
    });
  }

  return result;
}

// ============================================================
// ГЛАВНАЯ ФУНКЦИЯ: генерация полного PDF
// ============================================================

export function generateProtocolPdf(data: ReportData): void {
  const doc = createDoc();
  const name = data.tournament?.name || data.tournament_name_cached || 'Протокол';

  // 1. Титульная страница
  addTitlePage(doc, data);

  // 2. Распределение мест
  addPlacesSection(doc, data);

  // 3. Турнирные сетки
  addBracketsSection(doc, data);

  // 4. Сводная таблица поединков
  addResultsSection(doc, data);

  // Нумерация страниц
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120);
    doc.text(`${i} / ${totalPages}`, PAGE_W - MARGIN, 290, { align: 'right' });
    doc.setTextColor(0);
  }

  // Сохранение
  const safeName = name.replace(/[^а-яёА-ЯЁa-zA-Z0-9\s]/g, '').trim().slice(0, 50) || 'protokol';
  doc.save(`${safeName}_протокол.pdf`);
}
