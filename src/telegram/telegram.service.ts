import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as TelegramBot from 'node-telegram-bot-api';
import { isURL } from 'validator';

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: TelegramBot;
  private userStates = new Map<number, { state: string; page?: number }>();

  constructor(private readonly prisma: PrismaClient) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error(
        'TELEGRAM_BOT_TOKEN is not defined in environment variables',
      );
    }
    this.bot = new TelegramBot(token, { polling: true });
  }

  onModuleInit() {
    const keyboard = {
      reply_markup: {
        keyboard: [
          [{ text: 'Save 🔖' }, { text: 'List 📋' }],
          [{ text: 'Delete ❌' }, { text: 'Get 🔍' }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    };

    const inlineKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Save 🔖', callback_data: 'save' },
            { text: 'List 📋', callback_data: 'list' },
          ],
          [
            { text: 'Delete ❌', callback_data: 'delete' },
            { text: 'Get 🔍', callback_data: 'get' },
          ],
        ],
      },
    };

    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;

      this.bot.sendMessage(chatId, 'Добро пожаловать!', keyboard);

      this.bot.sendMessage(
        chatId,
        `Доступные команды:

Save 🔖 - сохраняет ссылку
List 📋 - возвращает список ваших ссылок
Delete ❌ - удаляет ссылку
Get 🔍 - возвращает ссылку по её id

Выберите команду из списка ниже:`,
        inlineKeyboard,
      );
    });

    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const text = msg.text;

      if (text.startsWith('/')) {
        return;
      }

      if (text === 'Save 🔖') {
        this.userStates.set(userId, { state: 'awaiting_save' });
        this.bot.sendMessage(
          chatId,
          'Пожалуйста, отправьте название и ссылку в формате: название ссылка.',
        );
      } else if (text === 'List 📋') {
        this.userStates.set(userId, { state: 'browsing_list', page: 1 });
        await this.handleList(chatId, userId, 1);
      } else if (text === 'Delete ❌') {
        this.userStates.set(userId, { state: 'awaiting_delete' });
        this.bot.sendMessage(
          chatId,
          'Пожалуйста, отправьте ID ссылки, которую вы хотите удалить.',
        );
      } else if (text === 'Get 🔍') {
        this.userStates.set(userId, { state: 'awaiting_get' });
        this.bot.sendMessage(
          chatId,
          'Пожалуйста, отправьте ID ссылки, которую вы хотите получить.',
        );
      } else {
        const userState = this.userStates.get(userId);

        if (userState?.state === 'awaiting_save') {
          await this.handleSave(chatId, userId, text);
          this.userStates.delete(userId);
        } else if (userState?.state === 'awaiting_delete') {
          await this.handleDelete(chatId, userId, text);
          this.userStates.delete(userId);
        } else if (userState?.state === 'awaiting_get') {
          await this.handleGet(chatId, text);
          this.userStates.delete(userId);
        } else {
          this.bot.sendMessage(chatId, 'Неизвестная команда');
        }
      }
    });

    this.bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const userId = callbackQuery.from.id;
      const data = callbackQuery.data;

      if (data === 'save') {
        this.userStates.set(userId, { state: 'awaiting_save' });
        this.bot.sendMessage(
          chatId,
          'Пожалуйста, отправьте название и ссылку в формате: название ссылка.',
        );
      } else if (data === 'list') {
        this.userStates.set(userId, { state: 'browsing_list', page: 1 });
        await this.handleList(chatId, userId, 1);
      } else if (data === 'delete') {
        this.userStates.set(userId, { state: 'awaiting_delete' });
        this.bot.sendMessage(
          chatId,
          'Пожалуйста, отправьте ID ссылки, которую вы хотите удалить.',
        );
      } else if (data === 'get') {
        this.userStates.set(userId, { state: 'awaiting_get' });
        this.bot.sendMessage(
          chatId,
          'Пожалуйста, отправьте ID ссылки, которую вы хотите получить.',
        );
      } else if (data === 'prev' || data === 'next') {
        const userState = this.userStates.get(userId);
        if (userState?.state === 'browsing_list') {
          let newPage = userState.page;
          newPage = data === 'prev' ? newPage - 1 : newPage + 1;
          if (newPage < 1) newPage = 1;
          this.userStates.set(userId, {
            state: 'browsing_list',
            page: newPage,
          });
          await this.handleList(chatId, userId, newPage);
        }
      }

      this.bot.answerCallbackQuery(callbackQuery.id);
    });
  }

  private async handleSave(chatId: number, userId: number, text: string) {
    const [name, url] = text.split(' ');
    if (name && url) {
      if (isURL(url)) {
        try {
          const link = await this.prisma.link.create({
            data: {
              name,
              url,
              userId,
            },
          });
          this.bot.sendMessage(
            chatId,
            `Ссылка сохранена! Уникальный код: ${link.id}`,
          );
        } catch (error) {
          if (error.code === 'P2002') {
            this.bot.sendMessage(chatId, 'Эта ссылка уже сохранена.');
          } else {
            this.bot.sendMessage(
              chatId,
              'Произошла ошибка при сохранении ссылки.',
            );
          }
        }
      } else {
        this.bot.sendMessage(chatId, 'Неверный формат URL.');
      }
    } else {
      this.bot.sendMessage(
        chatId,
        'Пожалуйста, отправьте название и ссылку в формате: название ссылка.',
      );
    }
  }

  private async handleList(chatId: number, userId: number, page: number) {
    const pageSize = 5;
    const links = await this.prisma.link.findMany({
      where: { userId },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, url: true, createdAt: true },
    });

    if (links.length === 0) {
      this.bot.sendMessage(chatId, 'У вас пока нет сохранённых ссылок.');
      return;
    }

    let response = `Ваши сохранённые ссылки (страница ${page}):\n`;
    links.forEach((link) => {
      response += `ID: ${link.id}\nНазвание: ${link.name}\nURL: ${link.url}\nСоздано: ${link.createdAt}\n\n`;
    });

    const inlineKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⬅️ Предыдущая', callback_data: 'prev' },
            { text: 'Следующая ➡️', callback_data: 'next' },
          ],
        ],
      },
    };

    this.bot.sendMessage(chatId, response, inlineKeyboard);
  }

  private async handleDelete(chatId: number, userId: number, text: string) {
    const id = parseInt(text);

    try {
      const link = await this.prisma.link.findUnique({ where: { id } });
      if (!link) {
        this.bot.sendMessage(chatId, 'Ссылка с таким ID не найдена.');
        return;
      }
      if (link.userId !== userId) {
        this.bot.sendMessage(chatId, 'Вы не можете удалить эту ссылку.');
        return;
      }

      await this.prisma.link.delete({ where: { id } });
      this.bot.sendMessage(chatId, 'Ссылка успешно удалена.');
    } catch (error) {
      this.bot.sendMessage(chatId, 'Произошла ошибка при удалении ссылки.');
    }
  }

  private async handleGet(chatId: number, text: string) {
    const id = parseInt(text);

    const link = await this.prisma.link.findUnique({ where: { id } });

    if (link) {
      this.bot.sendMessage(chatId, `URL: ${link.url}`);
    } else {
      this.bot.sendMessage(chatId, 'Ссылка с таким ID не найдена.');
    }
  }
}
