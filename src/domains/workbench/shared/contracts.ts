export interface WorkbenchBoard {
  id: string;
  name: string;
  description: string;
  path: string;
  sourceSessionId: string | null;
  automationId: string | null;
  createdAt: number;
  available: boolean;
  fileModifiedAt: number | null;
}
export type BoardInput = Pick<WorkbenchBoard, 'path' | 'name'> & Partial<Pick<WorkbenchBoard, 'description' | 'sourceSessionId'>>;
export type BoardPatch = Partial<Pick<WorkbenchBoard, 'name' | 'description' | 'sourceSessionId' | 'automationId'>>;
