import { Panel } from '@/components/admin/panel';
import { pickFile } from '@/components/professor/upload-dialog';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { api, type ImportReport, type PickedFile } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { CircleAlert, CircleCheck, FileSpreadsheet, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

const CSV_TYPES = ['.csv', 'text/csv', 'text/plain'];

export function ImportTab() {
  const { t } = useTranslation();
  return (
    <View className="gap-6">
      <CsvImport kind="roster" example={t('admin.import.rosterExample')} />
      <CsvImport kind="timetable" example={t('admin.import.timetableExample')} />
    </View>
  );
}

/** Preview first (dry run), then apply. Nothing is applied while the file has errors. */
function CsvImport({ kind, example }: { kind: 'roster' | 'timetable'; example: string }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(picked: PickedFile, dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.importCsv(kind, picked, dryRun));
    } catch (e) {
      setError(errorMessage(e));
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  async function choose() {
    const picked = await pickFile(CSV_TYPES);
    if (!picked) return;
    setFile(picked);
    await run(picked, true);
  }

  return (
    <Panel title={t(`admin.import.${kind}Title`)} description={t(`admin.import.${kind}Description`)}>
      <View className="rounded-md bg-muted/60 p-3">
        <Text className="font-mono text-xs leading-5">{example}</Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-3">
        <Button variant="outline" disabled={busy} onPress={choose}>
          <Icon as={FileSpreadsheet} />
          <Text>{file ? t('admin.import.chooseOther') : t('admin.import.choose')}</Text>
        </Button>
        {file && <Text className="text-sm text-muted-foreground">{file.name}</Text>}
      </View>
      {error && <Text className="text-sm text-destructive">{error}</Text>}
      {report && <ReportView report={report} />}
      {report?.dry_run && file && (
        <Button className="self-start" disabled={busy || report.errors.length > 0} onPress={() => run(file, false)}>
          <Icon as={CircleCheck} />
          <Text>{t('admin.import.apply')}</Text>
        </Button>
      )}
    </Panel>
  );
}

function ReportView({ report }: { report: ImportReport }) {
  const { t } = useTranslation();
  const summary = (bucket: Record<string, number>) =>
    Object.entries(bucket)
      .map(([key, count]) => `${t(`admin.import.things.${key}`)}: ${count}`)
      .join(', ') || '–';
  return (
    <View className="gap-3 rounded-md border border-border p-3">
      <View className="flex-row items-center gap-2">
        <Icon
          as={report.errors.length ? CircleAlert : CircleCheck}
          size={16}
          className={report.errors.length ? 'text-destructive' : 'text-green-600'}
        />
        <Text className="font-medium">
          {report.errors.length
            ? t('admin.import.hasErrors', { count: report.errors.length })
            : report.dry_run
              ? t('admin.import.previewOk', { rows: report.rows })
              : t('admin.import.applied', { rows: report.rows })}
        </Text>
      </View>
      {!report.errors.length && (
        <View className="gap-1">
          <Text className="text-sm">{t('admin.import.created', { summary: summary(report.created) })}</Text>
          <Text className="text-sm">{t('admin.import.updated', { summary: summary(report.updated) })}</Text>
          <Text className="text-sm">{t('admin.import.removed', { summary: summary(report.removed) })}</Text>
        </View>
      )}
      {report.errors.map((issue, n) => (
        <Text key={`e${n}`} className="text-sm text-destructive">
          {issue.line ? t('admin.import.line', { line: issue.line }) : ''}
          {issue.message}
        </Text>
      ))}
      {report.warnings.map((issue, n) => (
        <View key={`w${n}`} className="flex-row gap-1.5">
          <Icon as={TriangleAlert} size={14} className="mt-0.5 text-amber-600" />
          <Text className="flex-1 text-sm">
            {issue.line ? t('admin.import.line', { line: issue.line }) : ''}
            {issue.message}
          </Text>
        </View>
      ))}
    </View>
  );
}
