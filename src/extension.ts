import * as path from 'path';
import * as iconv from 'iconv-lite';
import * as vscode from 'vscode';

const RECORD_FILE_NAME = 'encoding-keeper.json';

type EncodingRecords = Record<string, string>;

interface EncodingRecordFile {
	version: 1;
	files: EncodingRecords;
	folders: EncodingRecords;
}

interface EncodingChoice {
	command: string;
	convertCommand: string;
	encoding: string;
	label: string;
}

interface ConversionSummary {
	converted: vscode.Uri[];
	skipped: string[];
	failed: string[];
}

const COMMON_ENCODINGS: EncodingChoice[] = [
	{ command: 'encodingKeeper.recordUtf8', convertCommand: 'encodingKeeper.convertUtf8', encoding: 'utf8', label: 'UTF-8' },
	{ command: 'encodingKeeper.recordGb2312', convertCommand: 'encodingKeeper.convertGb2312', encoding: 'gb2312', label: 'GB2312' },
	{ command: 'encodingKeeper.recordGbk', convertCommand: 'encodingKeeper.convertGbk', encoding: 'gbk', label: 'GBK' },
	{ command: 'encodingKeeper.recordUtf8Bom', convertCommand: 'encodingKeeper.convertUtf8Bom', encoding: 'utf8bom', label: 'UTF-8 with BOM' },
	{ command: 'encodingKeeper.recordGb18030', convertCommand: 'encodingKeeper.convertGb18030', encoding: 'gb18030', label: 'GB18030' },
	{ command: 'encodingKeeper.recordBig5', convertCommand: 'encodingKeeper.convertBig5', encoding: 'cp950', label: 'Big5' },
	{ command: 'encodingKeeper.recordShiftJis', convertCommand: 'encodingKeeper.convertShiftJis', encoding: 'shiftjis', label: 'Shift JIS' },
	{ command: 'encodingKeeper.recordWindows1252', convertCommand: 'encodingKeeper.convertWindows1252', encoding: 'windows1252', label: 'Windows 1252' }
];

const ICONV_ENCODINGS: Record<string, string> = {
	utf8: 'utf8',
	gb2312: 'gb2312',
	gbk: 'gbk',
	utf8bom: 'utf8',
	gb18030: 'gb18030',
	cp950: 'cp950',
	shiftjis: 'shiftjis',
	windows1252: 'win1252'
};

let statusBarItem: vscode.StatusBarItem;
const observedEncodings = new Map<string, string>();
const restoringUris = new Set<string>();
const recordCache = new Map<string, EncodingRecordFile>();

export function activate(context: vscode.ExtensionContext) {
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'encodingKeeper.showCurrentEncoding';
	statusBarItem.tooltip = 'Show current file encoding';

	context.subscriptions.push(
		statusBarItem,
		vscode.commands.registerCommand('encodingKeeper.showCurrentEncoding', showCurrentEncoding),
		vscode.commands.registerCommand('encodingKeeper.openWithRememberedEncoding', openWithRememberedEncoding),
		vscode.commands.registerCommand('encodingKeeper.clearEncodingRecord', clearEncodingRecord),
		vscode.commands.registerCommand('encodingKeeper.clearAllEncodingRecords', clearAllEncodingRecords),
		...COMMON_ENCODINGS.map((choice) => vscode.commands.registerCommand(
			choice.command,
			(uri?: vscode.Uri) => recordEncodingFromMenu(choice, uri)
		)),
		...COMMON_ENCODINGS.map((choice) => vscode.commands.registerCommand(
			choice.convertCommand,
			(uri?: vscode.Uri) => convertEncodingFromMenu(choice, uri)
		)),
		vscode.window.onDidChangeActiveTextEditor(() => {
			void updateStatusBar();
		}),
		vscode.workspace.onDidOpenTextDocument((document) => {
			void handleDocumentOpened(document);
		}),
		vscode.workspace.onDidChangeTextDocument((event) => {
			void handleDocumentEncodingChanged(event.document);
		}),
		vscode.workspace.onDidCloseTextDocument((document) => {
			observedEncodings.delete(getUriKey(document.uri));
		})
	);

	for (const document of vscode.workspace.textDocuments) {
		void handleDocumentOpened(document);
	}

	void updateStatusBar();
}

export function deactivate() {}

async function handleDocumentOpened(document: vscode.TextDocument): Promise<void> {
	try {
		if (!isLocalFileDocument(document)) {
			return;
		}

		const rememberedEncoding = await getRememberedEncoding(document.uri);
		if (!rememberedEncoding) {
			rememberObservedEncoding(document);
			void updateStatusBar();
			return;
		}

		if (document.encoding === rememberedEncoding) {
			rememberObservedEncoding(document);
			void updateStatusBar();
			return;
		}

		await reopenWithEncoding(document.uri, rememberedEncoding, false);
	} catch (error) {
		showError('Failed to restore remembered encoding.', error);
	}
}

async function handleDocumentEncodingChanged(document: vscode.TextDocument): Promise<void> {
	try {
		if (!isLocalFileDocument(document)) {
			return;
		}

		const uriKey = getUriKey(document.uri);
		const previousEncoding = observedEncodings.get(uriKey);

		if (previousEncoding === document.encoding) {
			return;
		}

		observedEncodings.set(uriKey, document.encoding);
		void updateStatusBar();

		if (!previousEncoding || restoringUris.has(uriKey)) {
			return;
		}

		await saveRememberedEncoding(document.uri, document.encoding);
	} catch (error) {
		showError('Failed to record encoding change.', error);
	}
}

async function showCurrentEncoding(): Promise<void> {
	try {
		const document = getActiveFileDocument();
		if (!document) {
			return;
		}

		void vscode.window.showInformationMessage(`Current encoding: ${document.encoding}`);
		void updateStatusBar();
	} catch (error) {
		showError('Failed to show current encoding.', error);
	}
}

async function recordEncodingFromMenu(choice: EncodingChoice, uriFromMenu?: vscode.Uri): Promise<void> {
	try {
		const uri = uriFromMenu ?? getActiveFileDocument()?.uri;
		if (!uri || uri.scheme !== 'file') {
			void vscode.window.showInformationMessage('Encoding Keeper only supports local files and folders.');
			return;
		}

		await saveMenuEncodingRecord(uri, choice.encoding);
		void updateStatusBar();
		void vscode.window.showInformationMessage(`Recorded ${choice.label} for ${uri.fsPath}.`);
	} catch (error) {
		showError(`Failed to record ${choice.label}.`, error);
	}
}

async function convertEncodingFromMenu(choice: EncodingChoice, uriFromMenu?: vscode.Uri): Promise<void> {
	try {
		const uri = uriFromMenu ?? getActiveFileDocument()?.uri;
		if (!uri || uri.scheme !== 'file') {
			void vscode.window.showInformationMessage('Encoding Keeper only supports local files and folders.');
			return;
		}

		const targetIsDirectory = await isDirectory(uri);
		if (targetIsDirectory) {
			await convertFolderEncoding(uri, choice);
			return;
		}

		const summary = createConversionSummary();
		await convertFileToEncoding(uri, choice, summary);
		await saveConvertedEncodingRecords(undefined, summary.converted, choice.encoding);
		void updateStatusBar();
		showConversionSummary(choice, summary);
	} catch (error) {
		showError(`Failed to convert to ${choice.label}.`, error);
	}
}

async function convertFolderEncoding(uri: vscode.Uri, choice: EncodingChoice): Promise<void> {
	const files = await collectFiles(uri);
	if (files.length === 0) {
		void vscode.window.showInformationMessage('No files found in this folder.');
		return;
	}

	const confirmation = await vscode.window.showWarningMessage(
		`Convert ${files.length} file(s) under "${uri.fsPath}" to ${choice.label}?`,
		{ modal: true },
		'Convert'
	);

	if (confirmation !== 'Convert') {
		return;
	}

	const summary = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Encoding Keeper: converting to ${choice.label}`,
			cancellable: false
		},
		async (progress) => {
			const result = createConversionSummary();
			for (let index = 0; index < files.length; index++) {
				progress.report({
					message: `${index + 1}/${files.length} ${vscode.workspace.asRelativePath(files[index], false)}`
				});
				await convertFileToEncoding(files[index], choice, result);
			}
			return result;
		}
	);

	await saveConvertedEncodingRecords(uri, summary.converted, choice.encoding);
	void updateStatusBar();
	showConversionSummary(choice, summary);
}

async function openWithRememberedEncoding(uriFromMenu?: vscode.Uri): Promise<void> {
	try {
		const uri = getTargetFileUri(uriFromMenu);
		if (!uri) {
			return;
		}

		const rememberedEncoding = await getRememberedEncoding(uri);
		if (!rememberedEncoding) {
			void vscode.window.showInformationMessage('No remembered encoding for this file.');
			return;
		}

		await reopenWithEncoding(uri, rememberedEncoding, true);
	} catch (error) {
		showError('Failed to open with remembered encoding.', error);
	}
}

async function clearEncodingRecord(uriFromMenu?: vscode.Uri): Promise<void> {
	try {
		const uri = getTargetFileUri(uriFromMenu);
		if (!uri) {
			return;
		}

		const folder = vscode.workspace.getWorkspaceFolder(uri);
		if (!folder) {
			void vscode.window.showInformationMessage('Encoding Keeper only records files inside a workspace folder.');
			return;
		}

		const records = await readRecords(folder);
		const recordKey = getRecordKey(uri, folder);
		if (!records.files[recordKey] && !records.folders[recordKey]) {
			void vscode.window.showInformationMessage('No encoding record for this file.');
			return;
		}

		delete records.files[recordKey];
		delete records.folders[recordKey];
		await writeRecords(folder, records);
		void updateStatusBar();
		void vscode.window.showInformationMessage('Encoding record cleared for this file.');
	} catch (error) {
		showError('Failed to clear encoding record.', error);
	}
}

async function clearAllEncodingRecords(): Promise<void> {
	try {
		const folders = vscode.workspace.workspaceFolders ?? [];
		if (folders.length === 0) {
			void vscode.window.showInformationMessage('No workspace folder is open.');
			return;
		}

		const confirmation = await vscode.window.showWarningMessage(
			'Clear all remembered encodings in this workspace?',
			{ modal: true },
			'Clear All'
		);

		if (confirmation !== 'Clear All') {
			return;
		}

		for (const folder of folders) {
			await writeRecords(folder, createEmptyRecordFile());
		}

		void updateStatusBar();
		void vscode.window.showInformationMessage('All encoding records cleared.');
	} catch (error) {
		showError('Failed to clear all encoding records.', error);
	}
}

async function reopenWithEncoding(uri: vscode.Uri, encoding: string, reveal: boolean): Promise<void> {
	const uriKey = getUriKey(uri);
	const openDocument = findOpenDocument(uri);

	if (openDocument?.isDirty && openDocument.encoding !== encoding) {
		void vscode.window.showWarningMessage(
			`Save or close this file before reopening it with remembered encoding ${encoding}.`
		);
		rememberObservedEncoding(openDocument);
		return;
	}

	restoringUris.add(uriKey);
	try {
		const document = await vscode.workspace.openTextDocument(uri, { encoding });
		rememberObservedEncoding(document);

		if (reveal) {
			await vscode.window.showTextDocument(document);
		}

		if (document.encoding !== encoding) {
			void vscode.window.showWarningMessage(
				`Tried to reopen with remembered encoding ${encoding}, but VS Code is using ${document.encoding}.`
			);
		}

		void updateStatusBar();
	} finally {
		restoringUris.delete(uriKey);
	}
}

async function convertFileToEncoding(
	uri: vscode.Uri,
	choice: EncodingChoice,
	summary: ConversionSummary
): Promise<void> {
	try {
		const openDocument = findOpenDocument(uri);
		const wasOpen = Boolean(openDocument);
		if (openDocument?.isDirty) {
			summary.skipped.push(`${uri.fsPath} (unsaved changes)`);
			return;
		}

		const bytes = await vscode.workspace.fs.readFile(uri);
		if (containsNullByte(bytes)) {
			summary.skipped.push(`${uri.fsPath} (binary file)`);
			return;
		}

		const rememberedEncoding = await getRememberedEncoding(uri);
		const text = rememberedEncoding
			? decodeText(bytes, rememberedEncoding)
			: (openDocument ?? await vscode.workspace.openTextDocument(uri)).getText();
		const encodedBytes = encodeText(text, choice.encoding);

		await vscode.workspace.fs.writeFile(uri, encodedBytes);
		summary.converted.push(uri);

		if (wasOpen) {
			await reopenWithEncoding(uri, choice.encoding, false);
		}
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		summary.failed.push(`${uri.fsPath} (${detail})`);
	}
}

async function collectFiles(uri: vscode.Uri): Promise<vscode.Uri[]> {
	const files: vscode.Uri[] = [];
	const entries = await vscode.workspace.fs.readDirectory(uri);

	for (const [name, type] of entries) {
		const child = vscode.Uri.joinPath(uri, name);
		if ((type & vscode.FileType.SymbolicLink) !== 0) {
			continue;
		}

		if ((type & vscode.FileType.Directory) !== 0) {
			files.push(...await collectFiles(child));
			continue;
		}

		if ((type & vscode.FileType.File) !== 0) {
			files.push(child);
		}
	}

	return files;
}

async function saveConvertedEncodingRecords(
	folderUri: vscode.Uri | undefined,
	fileUris: vscode.Uri[],
	encoding: string
): Promise<void> {
	const recordsByFolder = new Map<string, { folder: vscode.WorkspaceFolder; records: EncodingRecordFile }>();

	async function getRecords(folder: vscode.WorkspaceFolder) {
		const folderKey = getUriKey(folder.uri);
		const cached = recordsByFolder.get(folderKey);
		if (cached) {
			return cached.records;
		}

		const records = await readRecords(folder);
		recordsByFolder.set(folderKey, { folder, records });
		return records;
	}

	if (folderUri) {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(folderUri);
		if (workspaceFolder) {
			const records = await getRecords(workspaceFolder);
			records.folders[getRecordKey(folderUri, workspaceFolder)] = encoding;
		}
	}

	for (const fileUri of fileUris) {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
		if (!workspaceFolder) {
			continue;
		}

		const records = await getRecords(workspaceFolder);
		records.files[getRecordKey(fileUri, workspaceFolder)] = encoding;
	}

	for (const { folder, records } of recordsByFolder.values()) {
		await writeRecords(folder, records);
	}
}

function encodeText(text: string, encoding: string): Uint8Array {
	const iconvEncoding = ICONV_ENCODINGS[encoding];
	if (!iconvEncoding) {
		throw new Error(`Unsupported encoding: ${encoding}`);
	}

	const encoded = iconv.encode(text, iconvEncoding);
	if (encoding === 'utf8bom') {
		return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encoded]);
	}

	return encoded;
}

function decodeText(bytes: Uint8Array, encoding: string): string {
	const iconvEncoding = ICONV_ENCODINGS[encoding];
	if (!iconvEncoding) {
		throw new Error(`Unsupported encoding: ${encoding}`);
	}

	return iconv.decode(Buffer.from(bytes), iconvEncoding);
}

function containsNullByte(bytes: Uint8Array): boolean {
	return bytes.includes(0);
}

function createConversionSummary(): ConversionSummary {
	return {
		converted: [],
		skipped: [],
		failed: []
	};
}

function showConversionSummary(choice: EncodingChoice, summary: ConversionSummary): void {
	const message = `Converted ${summary.converted.length} file(s) to ${choice.label}.`;
	const details = [
		...summary.skipped.slice(0, 3).map((entry) => `Skipped: ${entry}`),
		...summary.failed.slice(0, 3).map((entry) => `Failed: ${entry}`)
	];
	const remaining = summary.skipped.length + summary.failed.length - details.length;
	const suffix = remaining > 0 ? ` ${remaining} more issue(s).` : '';

	if (summary.skipped.length > 0 || summary.failed.length > 0) {
		void vscode.window.showWarningMessage(`${message} ${details.join(' ')}${suffix}`);
		return;
	}

	void vscode.window.showInformationMessage(message);
}

async function getRememberedEncoding(uri: vscode.Uri): Promise<string | undefined> {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (!folder) {
		return undefined;
	}

	const records = await readRecords(folder);
	const recordKey = getRecordKey(uri, folder);
	return records.files[recordKey] ?? getFolderEncodingRecord(recordKey, records);
}

async function saveRememberedEncoding(uri: vscode.Uri, encoding: string): Promise<void> {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (!folder) {
		return;
	}

	const records = await readRecords(folder);
	const recordKey = getRecordKey(uri, folder);

	if (records.files[recordKey] === encoding) {
		return;
	}

	records.files[recordKey] = encoding;
	await writeRecords(folder, records);
}

async function saveMenuEncodingRecord(uri: vscode.Uri, encoding: string): Promise<void> {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (!folder) {
		void vscode.window.showInformationMessage('Encoding Keeper only records paths inside a workspace folder.');
		return;
	}

	const records = await readRecords(folder);
	const recordKey = getRecordKey(uri, folder);

	if (await isDirectory(uri)) {
		records.folders[recordKey] = encoding;
	} else {
		records.files[recordKey] = encoding;
	}

	await writeRecords(folder, records);
}

async function readRecords(folder: vscode.WorkspaceFolder): Promise<EncodingRecordFile> {
	const folderKey = getUriKey(folder.uri);
	const cachedRecords = recordCache.get(folderKey);
	if (cachedRecords) {
		return cachedRecords;
	}

	try {
		const bytes = await vscode.workspace.fs.readFile(getRecordFileUri(folder));
		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<EncodingRecordFile>;
		const records: EncodingRecordFile = {
			version: 1,
			files: isRecordMap(parsed.files) ? parsed.files : {},
			folders: isRecordMap(parsed.folders) ? parsed.folders : {}
		};
		recordCache.set(folderKey, records);
		return records;
	} catch {
		const records = createEmptyRecordFile();
		recordCache.set(folderKey, records);
		return records;
	}
}

async function writeRecords(folder: vscode.WorkspaceFolder, records: EncodingRecordFile): Promise<void> {
	const recordFileUri = getRecordFileUri(folder);
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.vscode'));
	await vscode.workspace.fs.writeFile(
		recordFileUri,
		new TextEncoder().encode(`${JSON.stringify(records, null, 2)}\n`)
	);
	recordCache.set(getUriKey(folder.uri), records);
}

function createEmptyRecordFile(): EncodingRecordFile {
	return {
		version: 1,
		files: {},
		folders: {}
	};
}

function getFolderEncodingRecord(fileRecordKey: string, records: EncodingRecordFile): string | undefined {
	const segments = fileRecordKey.split('/');

	while (segments.length > 1) {
		segments.pop();
		const folderKey = segments.join('/');
		const encoding = records.folders[folderKey];
		if (encoding) {
			return encoding;
		}
	}

	return records.folders[''];
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
	const stat = await vscode.workspace.fs.stat(uri);
	return (stat.type & vscode.FileType.Directory) !== 0;
}

function isRecordMap(value: unknown): value is EncodingRecords {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}

	return Object.values(value).every((encoding) => typeof encoding === 'string');
}

async function updateStatusBar(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !isLocalFileDocument(editor.document)) {
		statusBarItem.hide();
		return;
	}

	const document = editor.document;
	const activeUriKey = getUriKey(document.uri);
	const currentEncoding = document.encoding;
	const rememberedEncoding = await getRememberedEncoding(document.uri);

	if (vscode.window.activeTextEditor?.document.uri.toString() !== activeUriKey) {
		return;
	}

	statusBarItem.text = rememberedEncoding && rememberedEncoding !== currentEncoding
		? `Encoding: ${currentEncoding} / remembered: ${rememberedEncoding}`
		: `Encoding: ${currentEncoding}`;
	statusBarItem.show();
}

function rememberObservedEncoding(document: vscode.TextDocument): void {
	observedEncodings.set(getUriKey(document.uri), document.encoding);
}

function isLocalFileDocument(document: vscode.TextDocument): boolean {
	return document.uri.scheme === 'file';
}

function getRecordFileUri(folder: vscode.WorkspaceFolder): vscode.Uri {
	return vscode.Uri.joinPath(folder.uri, '.vscode', RECORD_FILE_NAME);
}

function getRecordKey(uri: vscode.Uri, folder: vscode.WorkspaceFolder): string {
	return path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
}

function getUriKey(uri: vscode.Uri): string {
	return uri.toString();
}

function getActiveFileDocument(): vscode.TextDocument | undefined {
	const document = vscode.window.activeTextEditor?.document;
	if (!document) {
		void vscode.window.showInformationMessage('No active editor.');
		return undefined;
	}

	if (!isLocalFileDocument(document)) {
		void vscode.window.showInformationMessage('Encoding Keeper only supports local files.');
		return undefined;
	}

	return document;
}

function getTargetFileUri(uriFromMenu?: vscode.Uri): vscode.Uri | undefined {
	if (uriFromMenu) {
		if (uriFromMenu.scheme !== 'file') {
			void vscode.window.showInformationMessage('Encoding Keeper only supports local files.');
			return undefined;
		}

		return uriFromMenu;
	}

	return getActiveFileDocument()?.uri;
}

function findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
	const uriKey = getUriKey(uri);
	return vscode.workspace.textDocuments.find((document) => getUriKey(document.uri) === uriKey);
}

function showError(message: string, error: unknown): void {
	const detail = error instanceof Error ? error.message : String(error);
	void vscode.window.showErrorMessage(`${message} ${detail}`);
}
