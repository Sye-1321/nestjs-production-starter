import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class CreateTaskDto {
  @Transform(
    ({ value }: TransformFnParams): unknown =>
      typeof value === 'string' ? value.trim() : value,
    { toClassOnly: true },
  )
  @IsString()
  @Length(1, 200)
  public title!: string;
}
