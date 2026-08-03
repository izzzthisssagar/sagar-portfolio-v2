import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { type AdminRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { ApproveMediaDto, ListMediaDto, RejectMediaDto, UpdateMediaDto } from './media.dto';
import { maxBytesFor } from './media-validation';
import { MediaService } from './media.service';

const MAX_UPLOAD_BYTES = Math.max(maxBytesFor('IMAGE'), maxBytesFor('DOCUMENT'));

@ApiTags('admin/media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CsrfGuard)
@Controller('admin/media')
export class AdminMediaController {
  constructor(private readonly media: MediaService) {}

  @Get() list(@Query() query: ListMediaDto) {
    return this.media.list(query);
  }

  @Get(':id') async get(@Param('id') id: string) {
    return { data: await this.media.get(id) };
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: AdminRequest,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded.');
    return {
      data: await this.media.upload(
        { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
        request.user?.sub,
      ),
    };
  }

  @Patch(':id') async update(
    @Param('id') id: string,
    @Body() input: UpdateMediaDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.media.update(id, input, request.user?.sub) };
  }

  @Post(':id/approve') async approve(
    @Param('id') id: string,
    @Body() input: ApproveMediaDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.media.approve(id, input, request.user?.sub) };
  }

  @Post(':id/reject') async reject(
    @Param('id') id: string,
    @Body() input: RejectMediaDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.media.reject(id, input, request.user?.sub) };
  }

  @Post(':id/archive') async archive(@Param('id') id: string, @Req() request: AdminRequest) {
    return { data: await this.media.archive(id, request.user?.sub) };
  }

  @Delete(':id') async remove(@Param('id') id: string, @Req() request: AdminRequest) {
    await this.media.remove(id, request.user?.sub);
    return { data: { deleted: true } };
  }
}
