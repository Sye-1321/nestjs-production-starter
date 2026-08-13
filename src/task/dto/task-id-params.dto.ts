import { IsUUID } from 'class-validator';

export class TaskIdParamsDto {
  @IsUUID()
  public id!: string;
}
