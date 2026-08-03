import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { type AdminRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { MediaService } from '../media/media.service';
import { CreateCvDocumentDto } from './cv.dto';
import { CvService } from './cv.service';

@ApiTags('documents')
@Controller('documents')
export class CvDownloadController {
  constructor(
    private readonly cv: CvService,
    private readonly media: MediaService,
  ) {}

  /** No storage path or internal id is ever reflected back — a fixed, safe filename regardless
   * of the stored document's title, since that title is admin-authored text that has no reason
   * to be trusted in an HTTP header. 404 (not an error) when no CV is active — a deliberately
   * unavailable state, not a broken one. */
  @Get('cv') async downloadCv(@Res() res: Response) {
    const active = await this.cv.getActivePublic();
    if (!active) throw new NotFoundException('No CV is currently available.');
    const { buffer } = await this.media.getFile(active.mediaId);
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Sagar-Thapa-CV.pdf"',
        'Cache-Control': 'public, max-age=300',
      })
      .send(buffer);
  }
}

@ApiTags('admin/cv')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CsrfGuard)
@Controller('admin/cv')
export class AdminCvController {
  constructor(private readonly cv: CvService) {}

  @Get() async list() {
    return { data: await this.cv.list() };
  }
  @Post() async create(@Body() input: CreateCvDocumentDto, @Req() request: AdminRequest) {
    return { data: await this.cv.create(input, request.user?.sub) };
  }
  @Post(':id/activate') async activate(@Param('id') id: string, @Req() request: AdminRequest) {
    return { data: await this.cv.activate(id, request.user?.sub) };
  }
  @Delete(':id') async remove(@Param('id') id: string, @Req() request: AdminRequest) {
    await this.cv.remove(id, request.user?.sub);
    return { data: { deleted: true } };
  }
}
